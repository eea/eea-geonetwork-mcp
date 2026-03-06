import axios, { AxiosInstance } from "axios";
import fs from "fs";
import FormData from "form-data";
import path from "path";
import {
  SearchRecordsArgs,
  GetRecordArgs,
  GetRecordSummaryArgs,
  GetRecordFormattersArgs,
  ExportRecordArgs,
  ListGroupsArgs,
  GetRelatedRecordsArgs,
  GetRegionsArgs,
  SearchByExtentArgs,
  DuplicateRecordArgs,
  UpdateRecordArgs,
  GetRecordByIdArgs,
  UpdateRecordTitleArgs,
  AddRecordTagsArgs,
  DeleteRecordTagsArgs,
  GetAttachmentsArgs,
  DeleteAttachmentArgs,
  UploadFileToRecordArgs,
  ToolResponse,
  HandlerConfig,
} from "./types.js";

export class ToolHandlers {
  private config: HandlerConfig;

  constructor(private axiosInstance: AxiosInstance, config: HandlerConfig) {
    this.config = config;
  }

  private formatResponse(data: any, isRaw = false): ToolResponse {
    return {
      content: [
        {
          type: "text",
          text: isRaw ? data : JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  private hasCredentials(): boolean {
    return Boolean(this.config.username && this.config.password);
  }

  private authRequiredResponse(action: string): ToolResponse {
    return {
      content: [
        {
          type: "text",
          text: `Error: Authentication required for ${action}. Please set CATALOGUE_USERNAME and CATALOGUE_PASSWORD in your .env file.`,
        },
      ],
      isError: true,
    };
  }

  async searchRecords(args: SearchRecordsArgs): Promise<ToolResponse> {
    const { query = "", from = 0, size = 10, bucket, sortBy, sortOrder } = args;

    // Use configurable max limit to prevent MCP streaming issues with large results
    const maxSize = this.config.maxSearchResults;
    const actualSize = Math.min(size, maxSize);

    // Normalize sort order - Elasticsearch only accepts "asc" or "desc"
    const normalizedSortOrder = sortOrder?.toLowerCase().startsWith("desc") ? "desc" : "asc";

    const searchBody: Record<string, any> = {
      from,
      size: actualSize,
      ...(query && { query: { query_string: { query } } }),
      ...(bucket && { aggregations: { [bucket]: { terms: { field: bucket } } } }),
      ...(sortBy && { sort: [{ [sortBy]: { order: normalizedSortOrder } }] }),
    };

    console.log(`[API] POST /search/records/_search`, JSON.stringify(searchBody, null, 2));

    const response = await this.axiosInstance.post("/search/records/_search", searchBody);

    const totalHits = response.data.hits?.total?.value || 0;
    console.log(`[API] ${response.status} - Found ${totalHits} results (returning ${actualSize}, max: ${maxSize})`);

    // Add warning if results were truncated
    if (totalHits > actualSize) {
      response.data._warning = `Results limited to ${actualSize} of ${totalHits} total. Use 'from' parameter to paginate.`;
    }

    return this.formatResponse(response.data);
  }

  async getRecord(args: GetRecordArgs): Promise<ToolResponse> {
    const { uuid, approved = true } = args;
    const response = await this.axiosInstance.get(`/records/${uuid}`, {
      params: { approved },
    });

    return this.formatResponse(response.data);
  }

  async getRecordSummary(args: GetRecordSummaryArgs): Promise<ToolResponse> {
    const { uuid } = args;

    const response = await this.axiosInstance.post("/search/records/_search", {
      query: { term: { uuid } },
      size: 1,
    });

    const hit = response.data?.hits?.hits?.[0]?._source;
    if (!hit) {
      return {
        content: [{ type: "text", text: `No record found with UUID: ${uuid}` }],
        isError: true,
      };
    }

    // Extract a flat, human-readable summary from the Elasticsearch document
    const pick = (obj: any, ...paths: string[]): any => {
      for (const p of paths) {
        const val = p.split(".").reduce((o, k) => o?.[k], obj);
        if (val !== undefined && val !== null && val !== "") return val;
      }
      return undefined;
    };

    const summary: Record<string, any> = {
      uuid: hit.uuid,
      title: pick(hit, "resourceTitleObject.default", "resourceTitle"),
      abstract: pick(hit, "resourceAbstractObject.default", "resourceAbstract"),
      type: hit.resourceType?.[0] ?? hit["th_hierarchylevel"]?.[0] ?? hit.type,
      status: hit.cl_status?.[0]?.default ?? hit.status,
      language: hit.mainLanguage ?? hit.language,
      created: hit.createDate,
      updated: hit.changeDate,
      published: hit.isPublishedToAll ?? false,
    };

    // Keywords
    const keywords: string[] = [];
    if (Array.isArray(hit.tag)) {
      hit.tag.forEach((t: any) => {
        const label = typeof t === "string" ? t : (t.default ?? t.key);
        if (label) keywords.push(label);
      });
    }
    if (keywords.length) summary.keywords = keywords;

    // Geographic extent
    if (hit.geom?.coordinates || hit.bbox) {
      const bbox = hit.bbox ?? hit.geom?.bbox;
      if (bbox) summary.extent = { bbox };
    } else if (hit.location) {
      summary.extent = { location: hit.location };
    }

    // Contacts
    if (Array.isArray(hit.contact) && hit.contact.length > 0) {
      summary.contacts = hit.contact.slice(0, 5).map((c: any) => ({
        name: c.individual ?? c.organisation ?? c.organisationObject?.default,
        role: c.role,
        email: c.email,
      })).filter((c: any) => c.name || c.email);
    }

    // Online resources / links
    if (Array.isArray(hit.link) && hit.link.length > 0) {
      summary.links = hit.link.slice(0, 10).map((l: any) => ({
        name: l.nameObject?.default ?? l.name,
        url: l.url ?? l.urlObject?.default,
        protocol: l.protocol,
        description: l.descriptionObject?.default ?? l.description,
      })).filter((l: any) => l.url);
    }

    // Remove undefined values
    Object.keys(summary).forEach(k => summary[k] === undefined && delete summary[k]);

    return this.formatResponse(summary);
  }

  async getRecordFormatters(args: GetRecordFormattersArgs): Promise<ToolResponse> {
    const response = await this.axiosInstance.get(`/records/${args.uuid}/formatters`);
    return this.formatResponse(response.data);
  }

  async exportRecord(args: ExportRecordArgs): Promise<ToolResponse> {
    const { uuid, formatter } = args;
    const response = await this.axiosInstance.get(
      `/records/${uuid}/formatters/${formatter}`,
      { responseType: "text" }
    );

    return this.formatResponse(response.data, true);
  }

  async listGroups(args: ListGroupsArgs): Promise<ToolResponse> {
    const { withReservedGroup = false } = args;
    const response = await this.axiosInstance.get("/groups", {
      params: { withReservedGroup },
    });

    return this.formatResponse(response.data);
  }

  async getSources(): Promise<ToolResponse> {
    const response = await this.axiosInstance.get("/sources");
    return this.formatResponse(response.data);
  }

  async getSiteInfo(): Promise<ToolResponse> {
    const response = await this.axiosInstance.get("/site");
    return this.formatResponse(response.data);
  }

  async getRelatedRecords(args: GetRelatedRecordsArgs): Promise<ToolResponse> {
    const { uuid, type } = args;
    const response = await this.axiosInstance.get(`/related/${uuid}`, {
      ...(type && { params: { type } }),
    });

    return this.formatResponse(response.data);
  }

  async getTags(): Promise<ToolResponse> {
    const response = await this.axiosInstance.get("/tags");
    return this.formatResponse(response.data);
  }

  async getRegions(args: GetRegionsArgs): Promise<ToolResponse> {
    const response = await this.axiosInstance.get("/regions", {
      ...(args.categoryId && { params: { categoryId: args.categoryId } }),
    });

    return this.formatResponse(response.data);
  }

  async searchByExtent(args: SearchByExtentArgs): Promise<ToolResponse> {
    const { minx, miny, maxx, maxy, relation = "intersects" } = args;

    const searchBody = {
      query: {
        bool: {
          must: [
            {
              geo_shape: {
                geom: {
                  shape: {
                    type: "envelope",
                    coordinates: [[minx, maxy], [maxx, miny]]
                  },
                  relation
                }
              }
            }
          ]
        }
      }
    };

    const response = await this.axiosInstance.post("/search/records/_search", searchBody);

    return this.formatResponse(response.data);
  }

  async duplicateRecord(args: DuplicateRecordArgs): Promise<ToolResponse> {
    if (!this.hasCredentials()) {
      return this.authRequiredResponse("duplicate_record");
    }

    const {
      metadataUuid,
      group,
      isChildOfSource = false,
      targetUuid,
      hasCategoryOfSource = true,
    } = args;

    const params: Record<string, any> = {
      sourceUuid: metadataUuid,
      ...(group && { group }),
      ...(isChildOfSource && { isChildOfSource: true }),
      ...(targetUuid && { targetUuid }),
      ...(!hasCategoryOfSource && { hasCategoryOfSource: false }),
    };

    const { cookieHeader } = await this.getAuthenticatedSession();
    const baseURL = this.axiosInstance.defaults.baseURL || "";

    try {
      const response = await axios.put(`${baseURL}/records/duplicate`, null, {
        params,
        headers: {
          Cookie: cookieHeader,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });

      const duplicateResult = response.data;
      let newUuid = duplicateResult.uuid || duplicateResult.metadataUuid;
      const newId = duplicateResult.id || duplicateResult.metadataId || duplicateResult;

      // If we got an ID but no UUID, fetch the record directly via the API
      if (!newUuid && newId && typeof newId === "number") {
        // Try direct API call first (most reliable, works immediately after creation)
        try {
          const recordResponse = await axios.get(`${baseURL}/records/${newId}`, {
            headers: {
              Cookie: cookieHeader,
              Accept: "application/json",
            },
          });
          newUuid = recordResponse.data?.uuid || recordResponse.data?.metadataIdentifier;
          console.log(`[Duplicate] Resolved UUID via direct API: ${newUuid}`);
        } catch {
          // Fall back to Elasticsearch search (may lag behind by a few seconds)
          try {
            const searchResponse = await this.axiosInstance.post("/search/records/_search", {
              query: { term: { _id: newId.toString() } },
              size: 1,
            });
            const hits = searchResponse.data.hits?.hits || [];
            if (hits.length > 0) {
              newUuid = hits[0]._source?.uuid || hits[0]._id;
              console.log(`[Duplicate] Resolved UUID via Elasticsearch: ${newUuid}`);
            }
          } catch {
            // UUID lookup failed, return with ID only
          }
        }
      }

      return this.formatResponse({
        success: true,
        message: "Record duplicated successfully",
        newId,
        newUuid,
        sourceUuid: metadataUuid,
      });
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Helper method to authenticate and get session cookies.
   * Tries signin first, then falls back to /site/info and /me to obtain JSESSIONID + XSRF-TOKEN.
   */
  private async getAuthenticatedSession(): Promise<{
    cookieHeader: string;
    xsrfToken: string;
  }> {
    if (!this.hasCredentials()) {
      throw new Error("Authentication credentials are not configured.");
    }

    const baseURL = this.axiosInstance.defaults.baseURL || "";
    const catalogueURL = baseURL.replace("/srv/api", "");

    let gnSessionId = "";
    let jsSessionId = "";
    let xsrfToken = "";

    // Step 1: Sign in to get session cookies
    const signinUrl = `${catalogueURL}/api/user/signin`;
    console.log(`[Auth] Signing in at: ${signinUrl}`);

    const formData = new URLSearchParams();
    formData.append("username", this.config.username);
    formData.append("password", this.config.password);

    try {
      const signinResponse = await axios.post(signinUrl, formData.toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json, text/html",
        },
        timeout: 10000,
        maxRedirects: 0,
        validateStatus: (status: number) => status < 400 || status === 302,
      });
      console.log(`[Auth] Signin → ${signinResponse.status}, Location: ${signinResponse.headers["location"] || "none"}`);
      console.log(`[Auth] Signin cookies: ${JSON.stringify(signinResponse.headers["set-cookie"])}`);
      for (const cookie of signinResponse.headers["set-cookie"] || []) {
        if (cookie.includes("GNSESSIONID=")) gnSessionId = cookie.split("GNSESSIONID=")[1].split(";")[0];
        if (cookie.includes("JSESSIONID=")) jsSessionId = cookie.split("JSESSIONID=")[1].split(";")[0];
        if (cookie.includes("XSRF-TOKEN=")) xsrfToken = cookie.split("XSRF-TOKEN=")[1].split(";")[0];
      }
    } catch (error: any) {
      console.log(`[Auth] Signin failed, trying fallback: ${error.message}`);
    }

    // Step 2: Fallback — GET /site/info to obtain JSESSIONID + XSRF-TOKEN
    if (!jsSessionId || !xsrfToken) {
      console.log(`[Auth] Fetching session via /site/info...`);
      try {
        const siteResponse = await axios.get(`${baseURL}/site/info`, {
          headers: {
            Accept: "application/json",
            Cookie: gnSessionId ? `GNSESSIONID=${gnSessionId}` : "",
          },
          timeout: 10000,
        });
        for (const cookie of siteResponse.headers["set-cookie"] || []) {
          if (cookie.includes("JSESSIONID=")) jsSessionId = cookie.split("JSESSIONID=")[1].split(";")[0];
          if (cookie.includes("XSRF-TOKEN=")) xsrfToken = cookie.split("XSRF-TOKEN=")[1].split(";")[0];
        }
        console.log(`[Auth] /site/info → JSESSIONID=${!!jsSessionId}, XSRF=${!!xsrfToken}`);
      } catch (error: any) {
        console.log(`[Auth] /site/info fallback failed: ${error.message}`);
      }
    }

    // Step 3: Fallback — GET /me with Basic Auth
    if (!xsrfToken) {
      console.log(`[Auth] Trying /me with Basic Auth...`);
      const cookieForMe = [
        jsSessionId ? `JSESSIONID=${jsSessionId}` : "",
        gnSessionId ? `GNSESSIONID=${gnSessionId}` : "",
      ].filter(Boolean).join("; ");
      try {
        const meResponse = await axios.get(`${baseURL}/me`, {
          headers: {
            Accept: "application/json",
            Cookie: cookieForMe,
            Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64")}`,
          },
          timeout: 10000,
          validateStatus: () => true,
        });
        for (const cookie of meResponse.headers["set-cookie"] || []) {
          if (cookie.includes("XSRF-TOKEN=")) xsrfToken = cookie.split("XSRF-TOKEN=")[1].split(";")[0];
          if (cookie.includes("JSESSIONID=")) jsSessionId = cookie.split("JSESSIONID=")[1].split(";")[0];
          if (cookie.includes("GNSESSIONID=")) gnSessionId = cookie.split("GNSESSIONID=")[1].split(";")[0];
        }
        console.log(`[Auth] /me → ${meResponse.status}, XSRF=${!!xsrfToken}`);
      } catch (error: any) {
        console.log(`[Auth] /me fallback failed: ${error.message}`);
      }
    }

    const cookieParts: string[] = [];
    if (jsSessionId) cookieParts.push(`JSESSIONID=${jsSessionId}`);
    if (gnSessionId) cookieParts.push(`GNSESSIONID=${gnSessionId}`);
    if (xsrfToken) cookieParts.push(`XSRF-TOKEN=${xsrfToken}`);
    const cookieHeader = cookieParts.join("; ");

    console.log(`[Auth] Session ready: JSESSIONID=${!!jsSessionId}, GNSESSIONID=${!!gnSessionId}, XSRF=${!!xsrfToken}`);
    return { cookieHeader, xsrfToken };
  }

  async updateRecord(args: UpdateRecordArgs): Promise<ToolResponse> {
    if (!this.hasCredentials()) {
      return this.authRequiredResponse("update_record");
    }

    const {
      uuid,
      xpath,
      value,
      operation = "replace",
      updateDateStamp = true,
    } = args;

    console.log(`[UpdateRecord] UUID: ${uuid}, XPath: ${xpath}, Operation: ${operation}`);

    const { cookieHeader } = await this.getAuthenticatedSession();
    const baseURL = this.axiosInstance.defaults.baseURL || "";

    // Build the batch editing request body
    // Wrap value with appropriate GeoNetwork operation tag
    let wrappedValue: string;
    switch (operation) {
      case "add":
        wrappedValue = `<gn_add>${value}</gn_add>`;
        break;
      case "delete":
        wrappedValue = "<gn_delete/>";
        break;
      case "replace":
      default:
        wrappedValue = `<gn_replace>${value}</gn_replace>`;
        break;
    }

    const editRequest = [
      {
        xpath,
        value: wrappedValue,
      },
    ];

    console.log(`[UpdateRecord] Request body:`, JSON.stringify(editRequest, null, 2));

    try {
      const response = await axios.put(
        `${baseURL}/records/batchediting`,
        editRequest,
        {
          params: {
            uuids: uuid,
            updateDateStamp: updateDateStamp.toString(),
          },
          headers: {
            Cookie: cookieHeader,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      console.log(`[UpdateRecord] Success:`, response.status);
      return this.formatResponse({
        success: true,
        message: `Record ${uuid} updated successfully`,
        details: response.data,
      });
    } catch (error: any) {
      console.log(`[UpdateRecord] Error:`, error.response?.data);
      throw error;
    }
  }

  async getRecordById(args: GetRecordByIdArgs): Promise<ToolResponse> {
    const { id } = args;

    console.log(`[GetRecordById] Searching for record with internal ID: ${id}`);

    // GeoNetwork stores internal ID in the 'id' field, not _id
    // Try multiple field names that might contain the internal ID
    const searchBody = {
      query: {
        bool: {
          should: [
            { term: { id: id } },
            { term: { "id.keyword": id.toString() } },
            { term: { _id: id.toString() } },
          ],
          minimum_should_match: 1,
        },
      },
      size: 1,
    };

    console.log(`[GetRecordById] Search query:`, JSON.stringify(searchBody));

    try {
      const response = await this.axiosInstance.post("/search/records/_search", searchBody);

      console.log(`[GetRecordById] Response hits:`, response.data.hits?.total);

      const hits = response.data.hits?.hits || [];
      if (hits.length === 0) {
        // If not found in search, try using the records API directly with authentication
        console.log(`[GetRecordById] Not found in search, trying direct API call with auth`);

        // Check if we have credentials
        if (this.hasCredentials()) {
          try {
            const { cookieHeader } = await this.getAuthenticatedSession();
            const baseURL = this.axiosInstance.defaults.baseURL || "";

            const directResponse = await axios.get(`${baseURL}/records/${id}`, {
              headers: {
                Cookie: cookieHeader,
                Accept: "application/json",
              },
            });

            const uuid = directResponse.data?.uuid || directResponse.data?.metadataIdentifier;
            console.log(`[GetRecordById] Found via direct API: UUID=${uuid}`);

            return this.formatResponse({
              id,
              uuid,
              title: directResponse.data?.resourceTitleObject?.default,
              source: directResponse.data,
            });
          } catch (directError: any) {
            console.log(`[GetRecordById] Direct API also failed:`, directError.response?.status, directError.response?.data);
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "Record not found",
                id,
                message: `No record found with internal ID ${id}. The record may not be indexed yet (newly created records can take a few seconds to appear in search). Try again in a moment or use get_record with the UUID if you have it.`,
              }, null, 2),
            },
          ],
          isError: true,
        };
      }

      const record = hits[0];
      const uuid = record._source?.uuid || record._source?.metadataIdentifier || record._id;

      console.log(`[GetRecordById] Found record: UUID=${uuid}`);

      return this.formatResponse({
        id,
        uuid,
        title: record._source?.resourceTitleObject?.default || record._source?.title,
        source: record._source,
      });
    } catch (error: any) {
      console.log(`[GetRecordById] Error:`, error.response?.data);
      throw error;
    }
  }

  async updateRecordTitle(args: UpdateRecordTitleArgs): Promise<ToolResponse> {
    if (!this.hasCredentials()) {
      return this.authRequiredResponse("update_record_title");
    }

    const { uuid, title } = args;

    console.log(`[UpdateRecordTitle] UUID: ${uuid}, New Title: ${title}`);

    const { cookieHeader } = await this.getAuthenticatedSession();
    const baseURL = this.axiosInstance.defaults.baseURL || "";

    // First, detect the schema by fetching the record's XML
    let schemaType = "iso19115-3"; // Default to ISO 19115-3 as it's more common in newer GeoNetwork
    try {
      const xmlResponse = await axios.get(`${baseURL}/records/${uuid}/formatters/xml`, {
        headers: {
          Cookie: cookieHeader,
          Accept: "application/xml",
        },
      });
      const xmlContent = xmlResponse.data;

      // Detect schema based on root element or namespace
      if (xmlContent.includes("gmd:MD_Metadata") || xmlContent.includes("xmlns:gmd=")) {
        schemaType = "iso19139";
        console.log(`[UpdateRecordTitle] Detected ISO 19139 schema`);
      } else if (xmlContent.includes("mdb:MD_Metadata") || xmlContent.includes("xmlns:mdb=")) {
        schemaType = "iso19115-3";
        console.log(`[UpdateRecordTitle] Detected ISO 19115-3 schema`);
      }
    } catch (detectError) {
      console.log(`[UpdateRecordTitle] Could not detect schema, using default: ${schemaType}`);
    }

    // Select the correct XPath based on schema
    let xpath: string;
    if (schemaType === "iso19139") {
      // ISO 19139 uses gmd: namespace
      xpath = "gmd:identificationInfo/*/gmd:citation/gmd:CI_Citation/gmd:title/gco:CharacterString";
    } else {
      // ISO 19115-3 uses mdb:, mri:, cit: namespaces
      xpath = "mdb:identificationInfo/*/mri:citation/cit:CI_Citation/cit:title/gco:CharacterString";
    }

    const editRequest = [
      {
        xpath,
        value: `<gn_replace>${title}</gn_replace>`,
      },
    ];

    console.log(`[UpdateRecordTitle] Schema: ${schemaType}, XPath: ${xpath}`);
    console.log(`[UpdateRecordTitle] Request body:`, JSON.stringify(editRequest, null, 2));

    try {
      const response = await axios.put(
        `${baseURL}/records/batchediting`,
        editRequest,
        {
          params: {
            uuids: uuid,
            updateDateStamp: "true",
          },
          headers: {
            Cookie: cookieHeader,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      console.log(`[UpdateRecordTitle] Response:`, response.status, JSON.stringify(response.data));

      return this.formatResponse({
        success: true,
        message: `Title of record ${uuid} updated to "${title}"`,
        schema: schemaType,
        details: response.data,
      });
    } catch (error: any) {
      console.log(`[UpdateRecordTitle] Error:`, error.response?.data);
      throw error;
    }
  }

  async addRecordTags(args: AddRecordTagsArgs): Promise<ToolResponse> {
    if (!this.hasCredentials()) {
      return this.authRequiredResponse("add_record_tags");
    }

    const { uuid, tags } = args;

    console.log(`[AddRecordTags] UUID: ${uuid}, Tags: ${tags.join(", ")}`);

    const { cookieHeader } = await this.getAuthenticatedSession();
    const baseURL = this.axiosInstance.defaults.baseURL || "";

    try {
      const qs = new URLSearchParams(tags.map(t => ["id", String(t)]));
      qs.append("clear", "false");
      const response = await axios.put(
        `${baseURL}/records/${uuid}/tags?${qs}`,
        null,
        {
          headers: {
            Cookie: cookieHeader,
            Accept: "application/json",
          },
        }
      );

      console.log(`[AddRecordTags] Response:`, response.status, JSON.stringify(response.data));

      return this.formatResponse({
        success: true,
        message: `Tags ${tags.join(", ")} added to record ${uuid}`,
        details: response.data,
      });
    } catch (error: any) {
      console.log(`[AddRecordTags] Error:`, error.response?.data);
      throw error;
    }
  }

  async deleteRecordTags(args: DeleteRecordTagsArgs): Promise<ToolResponse> {
    if (!this.hasCredentials()) {
      return this.authRequiredResponse("delete_record_tags");
    }

    const { uuid, tags } = args;

    console.log(`[DeleteRecordTags] UUID: ${uuid}, Tags: ${tags.join(", ")}`);

    const { cookieHeader } = await this.getAuthenticatedSession();
    const baseURL = this.axiosInstance.defaults.baseURL || "";

    try {
      const qs = new URLSearchParams(tags.map(t => ["id", String(t)]));
      const response = await axios.delete(
        `${baseURL}/records/${uuid}/tags?${qs}`,
        {
          headers: {
            Cookie: cookieHeader,
            Accept: "application/json",
          },
        }
      );

      console.log(`[DeleteRecordTags] Response:`, response.status, JSON.stringify(response.data));

      return this.formatResponse({
        success: true,
        message: `Tags ${tags.join(", ")} removed from record ${uuid}`,
        details: response.data,
      });
    } catch (error: any) {
      console.log(`[DeleteRecordTags] Error:`, error.response?.data);
      throw error;
    }
  }

  async getAttachments(args: GetAttachmentsArgs): Promise<ToolResponse> {
    const { metadataUuid, sort = "name", approved = true, filter = "*" } = args;

    console.log(`[GetAttachments] UUID: ${metadataUuid}, Sort: ${sort}, Filter: ${filter}`);

    try {
      const response = await this.axiosInstance.get(`/records/${metadataUuid}/attachments`, {
        params: {
          sort,
          approved,
          filter,
        },
      });

      console.log(`[GetAttachments] Found ${response.data?.length || 0} attachments`);

      return this.formatResponse(response.data);
    } catch (error: any) {
      console.log(`[GetAttachments] Error:`, error.response?.data);
      throw error;
    }
  }

  async deleteAttachment(args: DeleteAttachmentArgs): Promise<ToolResponse> {
    if (!this.hasCredentials()) {
      return this.authRequiredResponse("delete_attachment");
    }

    const { metadataUuid, resourceId, approved = false } = args;

    console.log(`[DeleteAttachment] UUID: ${metadataUuid}, Resource ID: ${resourceId}`);

    const { cookieHeader } = await this.getAuthenticatedSession();
    const baseURL = this.axiosInstance.defaults.baseURL || "";

    try {
      const response = await axios.delete(
        `${baseURL}/records/${metadataUuid}/attachments/${resourceId}`,
        {
          params: {
            approved,
          },
          headers: {
            Cookie: cookieHeader,
            Accept: "application/json",
          },
        }
      );

      console.log(`[DeleteAttachment] Response:`, response.status);

      return this.formatResponse({
        success: true,
        message: `Attachment ${resourceId} deleted from record ${metadataUuid}`,
      });
    } catch (error: any) {
      console.log(`[DeleteAttachment] Error:`, error.response?.data);
      throw error;
    }
  }

  async uploadFileToRecord(args: UploadFileToRecordArgs): Promise<ToolResponse> {
    if (!this.hasCredentials()) {
      return this.authRequiredResponse("upload_file_to_record");
    }

    const { metadataUuid, filePath, visibility = "PUBLIC", approved = false } = args;

    console.log(`[UploadFileToRecord] UUID: ${metadataUuid}, File: ${filePath}`);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return {
        content: [
          {
            type: "text",
            text: `Error: File not found at path: ${filePath}`,
          },
        ],
        isError: true,
      };
    }

    // Get file stats
    const stats = fs.statSync(filePath);
    const filename = path.basename(filePath);

    const { cookieHeader, xsrfToken } = await this.getAuthenticatedSession();
    const baseURL = this.axiosInstance.defaults.baseURL || "";

    try {
      // Create form data with file stream
      const formData = new FormData();
      const fileStream = fs.createReadStream(filePath);
      formData.append("file", fileStream, filename);

      // Get form headers (includes Content-Type with boundary)
      const formHeaders = formData.getHeaders();

      // Apache LDAP requires Basic Auth on the attachments POST endpoint.
      // Session cookies alone are not sufficient — we must include the Authorization header.
      const response = await axios.post(
        `${baseURL}/records/${metadataUuid}/attachments`,
        formData,
        {
          params: {
            visibility,
            approved,
          },
          headers: {
            ...formHeaders,
            Cookie: cookieHeader,
            "X-XSRF-TOKEN": xsrfToken || "",
            Accept: "application/json",
            Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64")}`,
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        }
      );

      return this.formatResponse({
        success: true,
        message: `File "${filename}" uploaded successfully to record ${metadataUuid}`,
        file: {
          name: filename,
          size: stats.size,
          path: filePath,
        },
        resource: response.data,
      });
    } catch (error: any) {
      const errorData = error.response?.data;
      const errorStatus = error.response?.status;
      console.log(`[UploadFileToRecord] Error status: ${errorStatus}`);
      console.log(`[UploadFileToRecord] Response headers: ${JSON.stringify(error.response?.headers)}`);

      // Provide helpful error message for access denied
      if (errorStatus === 500 && errorData?.message === "Access Denied") {
        return {
          content: [
            {
              type: "text",
              text: `Error: Access Denied. The record may be published/approved or you may not have edit permissions.\n\n` +
                `Suggestion: Try using duplicate_record to create a draft copy first.\n\n` +
                `Record UUID: ${metadataUuid}\n` +
                `Error: ${JSON.stringify(errorData, null, 2)}`,
            },
          ],
          isError: true,
        };
      }

      throw error;
    }
  }
}
