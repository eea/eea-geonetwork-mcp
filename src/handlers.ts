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
      metadataUuid,
      ...(group && { group }),
      ...(isChildOfSource && { isChildOfSource: true }),
      ...(targetUuid && { targetUuid }),
      ...(!hasCategoryOfSource && { hasCategoryOfSource: false }),
    };

    // Create Basic Auth header for this request
    const auth = Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64");

    const response = await this.axiosInstance.put("/records/duplicate", null, {
      params,
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    return this.formatResponse(response.data);
  }
}
