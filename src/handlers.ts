import { AxiosInstance } from "axios";
import {
  SearchRecordsArgs,
  GetRecordArgs,
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
  UploadResourceFromUrlArgs,
  GetAttachmentsArgs,
  DeleteAttachmentArgs,
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
    // Check if authentication is configured
    if (!this.config.username || !this.config.password) {
      return {
        content: [
          {
            type: "text",
            text: "Error: Authentication required for duplicate_record. Please set CATALOGUE_USERNAME and CATALOGUE_PASSWORD in your .env file.",
          },
        ],
        isError: true,
      };
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

    // GeoNetwork requires session-based auth for write operations
    const axios = (await import("axios")).default;
    const baseURL = this.axiosInstance.defaults.baseURL || "";
    // Convert /srv/api to base catalogue URL
    const catalogueURL = baseURL.replace("/srv/api", "");

    console.log(`[Auth] Username: ${this.config.username}`);
    console.log(`[Auth] Password length: ${this.config.password?.length}`);

    // Step 1: Sign in to get GNSESSIONID (GeoNetwork 5 style)
    const signinUrl = `${catalogueURL}/api/user/signin`;
    console.log(`[Auth] Step 1 - Signing in at: ${signinUrl}`);

    // Use URLSearchParams for form-urlencoded data (like a form submit)
    const formData = new URLSearchParams();
    formData.append("username", this.config.username);
    formData.append("password", this.config.password);

    const signinResponse = await axios.post(
      signinUrl,
      formData.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json, text/html",
        },
        timeout: 10000,
        maxRedirects: 0,
        validateStatus: (status) => status < 400 || status === 302,
      }
    );

    console.log(`[Auth] Step 1 - signin status: ${signinResponse.status}`);
    console.log(`[Auth] Step 1 - signin data:`, JSON.stringify(signinResponse.data));
    console.log(`[Auth] Step 1 - signin cookies:`, signinResponse.headers["set-cookie"]);

    let gnSessionId = "";
    let jsSessionId = "";
    const signinCookies = signinResponse.headers["set-cookie"] || [];

    for (const cookie of signinCookies) {
      if (cookie.includes("GNSESSIONID=")) {
        gnSessionId = cookie.split("GNSESSIONID=")[1].split(";")[0];
      }
      if (cookie.includes("JSESSIONID=")) {
        jsSessionId = cookie.split("JSESSIONID=")[1].split(";")[0];
      }
    }
    console.log(`[Auth] Step 1 - GNSESSIONID: ${gnSessionId ? "obtained" : "missing"}, JSESSIONID: ${jsSessionId ? "obtained" : "missing"}`);

    // Step 2: Get JSESSIONID from /srv/api if not already obtained
    if (!jsSessionId) {
      const siteResponse = await axios.get(`${baseURL}/site/info`, {
        headers: {
          Accept: "application/json",
          Cookie: gnSessionId ? `GNSESSIONID=${gnSessionId}` : "",
        },
        timeout: 10000,
      });

      const siteCookies = siteResponse.headers["set-cookie"] || [];
      for (const cookie of siteCookies) {
        if (cookie.includes("JSESSIONID=")) {
          jsSessionId = cookie.split("JSESSIONID=")[1].split(";")[0];
        }
      }
      console.log(`[Auth] Step 2 - JSESSIONID from /site/info: ${jsSessionId ? "obtained" : "missing"}`);
    }

    // Build cookie header
    const cookieParts: string[] = [];
    if (jsSessionId) cookieParts.push(`JSESSIONID=${jsSessionId}`);
    if (gnSessionId) cookieParts.push(`GNSESSIONID=${gnSessionId}`);
    const cookieHeader = cookieParts.join("; ");

    console.log(`[Auth] Cookies: ${cookieHeader}`);
    console.log(`[Auth] Params:`, params);

    // Step 3: Make the duplicate request with session cookies
    try {
      const response = await axios.put(`${baseURL}/records/duplicate`, null, {
        params,
        headers: {
          Cookie: cookieHeader,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });

      // The duplicate endpoint returns the new record's internal ID
      // Try to fetch the UUID from the response or by querying for it
      const duplicateResult = response.data;
      let newUuid = duplicateResult.uuid || duplicateResult.metadataUuid;
      const newId = duplicateResult.id || duplicateResult.metadataId || duplicateResult;

      console.log(`[Duplicate] Response:`, JSON.stringify(duplicateResult));

      // If we got an ID but no UUID, try to look it up
      if (!newUuid && newId && typeof newId === "number") {
        console.log(`[Duplicate] Looking up UUID for new record ID: ${newId}`);
        try {
          // Search for the record by internal ID
          const searchBody = {
            query: { term: { _id: newId.toString() } },
            size: 1,
          };
          const searchResponse = await this.axiosInstance.post("/search/records/_search", searchBody);
          const hits = searchResponse.data.hits?.hits || [];
          if (hits.length > 0) {
            newUuid = hits[0]._source?.uuid || hits[0]._id;
          }
        } catch (lookupError) {
          console.log(`[Duplicate] Could not look up UUID for ID ${newId}`);
        }
      }

      return this.formatResponse({
        success: true,
        message: "Record duplicated successfully",
        newId,
        newUuid,
        sourceUuid: metadataUuid,
        rawResponse: duplicateResult,
      });
    } catch (error: any) {
      console.log(`[Auth] Error response:`, error.response?.data);
      throw error;
    }
  }

  /**
   * Helper method to authenticate and get session cookies
   */
  private async getAuthenticatedSession(): Promise<{ cookieHeader: string; axios: any }> {
    const axios = (await import("axios")).default;
    const baseURL = this.axiosInstance.defaults.baseURL || "";
    const catalogueURL = baseURL.replace("/srv/api", "");

    // Step 1: Sign in to get GNSESSIONID
    const signinUrl = `${catalogueURL}/api/user/signin`;
    const formData = new URLSearchParams();
    formData.append("username", this.config.username);
    formData.append("password", this.config.password);

    const signinResponse = await axios.post(
      signinUrl,
      formData.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json, text/html",
        },
        timeout: 10000,
        maxRedirects: 0,
        validateStatus: (status: number) => status < 400 || status === 302,
      }
    );

    let gnSessionId = "";
    let jsSessionId = "";
    const signinCookies = signinResponse.headers["set-cookie"] || [];

    for (const cookie of signinCookies) {
      if (cookie.includes("GNSESSIONID=")) {
        gnSessionId = cookie.split("GNSESSIONID=")[1].split(";")[0];
      }
      if (cookie.includes("JSESSIONID=")) {
        jsSessionId = cookie.split("JSESSIONID=")[1].split(";")[0];
      }
    }

    // Step 2: Get JSESSIONID if not already obtained
    if (!jsSessionId) {
      const siteResponse = await axios.get(`${baseURL}/site/info`, {
        headers: {
          Accept: "application/json",
          Cookie: gnSessionId ? `GNSESSIONID=${gnSessionId}` : "",
        },
        timeout: 10000,
      });

      const siteCookies = siteResponse.headers["set-cookie"] || [];
      for (const cookie of siteCookies) {
        if (cookie.includes("JSESSIONID=")) {
          jsSessionId = cookie.split("JSESSIONID=")[1].split(";")[0];
        }
      }
    }

    // Build cookie header
    const cookieParts: string[] = [];
    if (jsSessionId) cookieParts.push(`JSESSIONID=${jsSessionId}`);
    if (gnSessionId) cookieParts.push(`GNSESSIONID=${gnSessionId}`);
    const cookieHeader = cookieParts.join("; ");

    console.log(`[Auth] Session obtained: JSESSIONID=${jsSessionId ? "yes" : "no"}, GNSESSIONID=${gnSessionId ? "yes" : "no"}`);

    return { cookieHeader, axios };
  }

  async updateRecord(args: UpdateRecordArgs): Promise<ToolResponse> {
    // Check if authentication is configured
    if (!this.config.username || !this.config.password) {
      return {
        content: [
          {
            type: "text",
            text: "Error: Authentication required for update_record. Please set CATALOGUE_USERNAME and CATALOGUE_PASSWORD in your .env file.",
          },
        ],
        isError: true,
      };
    }

    const {
      uuid,
      xpath,
      value,
      operation = "replace",
      updateDateStamp = true,
    } = args;

    console.log(`[UpdateRecord] UUID: ${uuid}, XPath: ${xpath}, Operation: ${operation}`);

    // Get authenticated session
    const { cookieHeader, axios } = await this.getAuthenticatedSession();
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
        if (this.config.username && this.config.password) {
          try {
            const { cookieHeader, axios } = await this.getAuthenticatedSession();
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
    // Check if authentication is configured
    if (!this.config.username || !this.config.password) {
      return {
        content: [
          {
            type: "text",
            text: "Error: Authentication required for update_record_title. Please set CATALOGUE_USERNAME and CATALOGUE_PASSWORD in your .env file.",
          },
        ],
        isError: true,
      };
    }

    const { uuid, title } = args;

    console.log(`[UpdateRecordTitle] UUID: ${uuid}, New Title: ${title}`);

    // Get authenticated session
    const { cookieHeader, axios } = await this.getAuthenticatedSession();
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
    // Check if authentication is configured
    if (!this.config.username || !this.config.password) {
      return {
        content: [
          {
            type: "text",
            text: "Error: Authentication required for add_record_tags. Please set CATALOGUE_USERNAME and CATALOGUE_PASSWORD in your .env file.",
          },
        ],
        isError: true,
      };
    }

    const { uuid, tags } = args;

    console.log(`[AddRecordTags] UUID: ${uuid}, Tags: ${tags.join(", ")}`);

    // Get authenticated session
    const { cookieHeader, axios } = await this.getAuthenticatedSession();
    const baseURL = this.axiosInstance.defaults.baseURL || "";

    try {
      const response = await axios.put(
        `${baseURL}/records/${uuid}/tags`,
        tags,
        {
          params: {
            clear: false,
          },
          headers: {
            Cookie: cookieHeader,
            Accept: "application/json",
            "Content-Type": "application/json",
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
    // Check if authentication is configured
    if (!this.config.username || !this.config.password) {
      return {
        content: [
          {
            type: "text",
            text: "Error: Authentication required for delete_record_tags. Please set CATALOGUE_USERNAME and CATALOGUE_PASSWORD in your .env file.",
          },
        ],
        isError: true,
      };
    }

    const { uuid, tags } = args;

    console.log(`[DeleteRecordTags] UUID: ${uuid}, Tags: ${tags.join(", ")}`);

    // Get authenticated session
    const { cookieHeader, axios } = await this.getAuthenticatedSession();
    const baseURL = this.axiosInstance.defaults.baseURL || "";

    try {
      const response = await axios.delete(
        `${baseURL}/records/${uuid}/tags`,
        {
          data: tags,
          headers: {
            Cookie: cookieHeader,
            Accept: "application/json",
            "Content-Type": "application/json",
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

  async uploadResourceFromUrl(args: UploadResourceFromUrlArgs): Promise<ToolResponse> {
    // Check if authentication is configured
    if (!this.config.username || !this.config.password) {
      return {
        content: [
          {
            type: "text",
            text: "Error: Authentication required for upload_resource_from_url. Please set CATALOGUE_USERNAME and CATALOGUE_PASSWORD in your .env file.",
          },
        ],
        isError: true,
      };
    }

    const { metadataUuid, url, visibility = "PUBLIC", approved = false } = args;

    console.log(`[UploadResourceFromUrl] UUID: ${metadataUuid}, URL: ${url}, Visibility: ${visibility}`);

    // Get authenticated session
    const { cookieHeader, axios } = await this.getAuthenticatedSession();
    const baseURL = this.axiosInstance.defaults.baseURL || "";

    try {
      const response = await axios.put(
        `${baseURL}/records/${metadataUuid}/attachments`,
        null,
        {
          params: {
            url,
            visibility,
            approved,
          },
          headers: {
            Cookie: cookieHeader,
            Accept: "application/json",
          },
        }
      );

      console.log(`[UploadResourceFromUrl] Response:`, response.status, JSON.stringify(response.data));

      return this.formatResponse({
        success: true,
        message: `Resource uploaded successfully from ${url} to record ${metadataUuid}`,
        resource: response.data,
      });
    } catch (error: any) {
      console.log(`[UploadResourceFromUrl] Error:`, error.response?.data);
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
    // Check if authentication is configured
    if (!this.config.username || !this.config.password) {
      return {
        content: [
          {
            type: "text",
            text: "Error: Authentication required for delete_attachment. Please set CATALOGUE_USERNAME and CATALOGUE_PASSWORD in your .env file.",
          },
        ],
        isError: true,
      };
    }

    const { metadataUuid, resourceId, approved = false } = args;

    console.log(`[DeleteAttachment] UUID: ${metadataUuid}, Resource ID: ${resourceId}`);

    // Get authenticated session
    const { cookieHeader, axios } = await this.getAuthenticatedSession();
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
}
