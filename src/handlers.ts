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
} from "./types.js";

export class ToolHandlers {
  constructor(private axiosInstance: AxiosInstance) {}

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

    const searchBody: Record<string, any> = {
      from,
      size: Math.min(size, 100),
      ...(query && { query: { query_string: { query } } }),
      ...(bucket && { aggregations: { [bucket]: { terms: { field: bucket } } } }),
      ...(sortBy && { sort: [{ [sortBy]: { order: sortOrder || "asc" } }] }),
    };

    console.log(`[API] POST /search/records/_search`, JSON.stringify(searchBody, null, 2));

    const response = await this.axiosInstance.post("/search/records/_search", searchBody);

    console.log(`[API] ${response.status} - Found ${response.data.hits?.total?.value || 0} results`);

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

    const response = await this.axiosInstance.put("/records/duplicate", null, {
      params,
    });

    return this.formatResponse(response.data);
  }
}
