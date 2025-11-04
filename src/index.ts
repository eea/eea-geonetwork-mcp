#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosInstance } from "axios";

const BASE_URL = "https://galliwasp.eea.europa.eu/catalogue/srv/api";

interface EEACatalogueConfig {
  baseUrl: string;
  portal: string;
}

class EEACatalogueServer {
  private server: Server;
  private axiosInstance: AxiosInstance;
  private config: EEACatalogueConfig;

  constructor() {
    this.config = {
      baseUrl: BASE_URL,
      portal: "eng",
    };

    this.server = new Server(
      {
        name: "eea-sdi-catalogue",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.axiosInstance = axios.create({
      baseURL: this.config.baseUrl,
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });

    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error("[MCP Error]", error);
    };

    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getTools(),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) =>
      this.handleToolCall(request)
    );
  }

  private getTools(): Tool[] {
    return [
      {
        name: "search_records",
        description: "Search for metadata records in the EEA catalogue. Supports full Elasticsearch query syntax.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query text (searches across all fields)",
            },
            from: {
              type: "number",
              description: "Starting position for results (default: 0)",
              default: 0,
            },
            size: {
              type: "number",
              description: "Number of results to return (default: 10, max: 100)",
              default: 10,
            },
            bucket: {
              type: "string",
              description: "Filter by specific facet bucket",
            },
            sortBy: {
              type: "string",
              description: "Field to sort by (e.g., 'resourceTitleObject.default.sort')",
            },
            sortOrder: {
              type: "string",
              enum: ["asc", "desc"],
              description: "Sort order (ascending or descending)",
            },
          },
        },
      },
      {
        name: "get_record",
        description: "Get detailed metadata for a specific record by its UUID or ID",
        inputSchema: {
          type: "object",
          properties: {
            uuid: {
              type: "string",
              description: "The UUID or ID of the metadata record",
            },
            approved: {
              type: "boolean",
              description: "Only return approved versions (default: true)",
              default: true,
            },
          },
          required: ["uuid"],
        },
      },
      {
        name: "get_record_formatters",
        description: "Get available formatters (export formats) for a metadata record",
        inputSchema: {
          type: "object",
          properties: {
            uuid: {
              type: "string",
              description: "The UUID of the metadata record",
            },
          },
          required: ["uuid"],
        },
      },
      {
        name: "export_record",
        description: "Export a metadata record in a specific format (XML, PDF, etc.)",
        inputSchema: {
          type: "object",
          properties: {
            uuid: {
              type: "string",
              description: "The UUID of the metadata record",
            },
            formatter: {
              type: "string",
              description: "The formatter/format to use (e.g., 'xml', 'pdf', 'full_view')",
            },
          },
          required: ["uuid", "formatter"],
        },
      },
      {
        name: "list_groups",
        description: "List all groups in the catalogue",
        inputSchema: {
          type: "object",
          properties: {
            withReservedGroup: {
              type: "boolean",
              description: "Include reserved system groups",
              default: false,
            },
          },
        },
      },
      {
        name: "get_sources",
        description: "Get information about catalogue sources (sub-portals)",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_site_info",
        description: "Get general information about the catalogue site configuration",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_related_records",
        description: "Get records related to a specific record (parent, children, services, datasets, etc.)",
        inputSchema: {
          type: "object",
          properties: {
            uuid: {
              type: "string",
              description: "The UUID of the metadata record",
            },
            type: {
              type: "string",
              description: "Type of relationship (e.g., 'children', 'parent', 'services', 'datasets', 'sources', 'associated')",
            },
          },
          required: ["uuid"],
        },
      },
      {
        name: "get_tags",
        description: "Get all available tags/categories in the catalogue",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_regions",
        description: "Get geographic regions/extents available in the catalogue",
        inputSchema: {
          type: "object",
          properties: {
            categoryId: {
              type: "string",
              description: "Filter regions by category ID",
            },
          },
        },
      },
      {
        name: "search_by_extent",
        description: "Search for records by geographic extent (bounding box)",
        inputSchema: {
          type: "object",
          properties: {
            minx: {
              type: "number",
              description: "Minimum longitude (west)",
            },
            miny: {
              type: "number",
              description: "Minimum latitude (south)",
            },
            maxx: {
              type: "number",
              description: "Maximum longitude (east)",
            },
            maxy: {
              type: "number",
              description: "Maximum latitude (north)",
            },
            relation: {
              type: "string",
              enum: ["intersects", "within", "contains"],
              description: "Spatial relationship (default: intersects)",
              default: "intersects",
            },
          },
          required: ["minx", "miny", "maxx", "maxy"],
        },
      },
    ];
  }

  private async handleToolCall(request: any) {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "search_records":
          return await this.searchRecords(args);
        case "get_record":
          return await this.getRecord(args);
        case "get_record_formatters":
          return await this.getRecordFormatters(args);
        case "export_record":
          return await this.exportRecord(args);
        case "list_groups":
          return await this.listGroups(args);
        case "get_sources":
          return await this.getSources();
        case "get_site_info":
          return await this.getSiteInfo();
        case "get_related_records":
          return await this.getRelatedRecords(args);
        case "get_tags":
          return await this.getTags();
        case "get_regions":
          return await this.getRegions(args);
        case "search_by_extent":
          return await this.searchByExtent(args);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error.message}\n${error.response?.data ? JSON.stringify(error.response.data, null, 2) : ""}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async searchRecords(args: any) {
    const { query = "", from = 0, size = 10, bucket, sortBy, sortOrder } = args;

    const searchParams: any = {
      from,
      size: Math.min(size, 100),
    };

    if (query) {
      searchParams.any = query;
    }

    if (bucket) {
      searchParams.bucket = bucket;
    }

    if (sortBy) {
      searchParams.sortBy = sortBy;
      searchParams.sortOrder = sortOrder || "asc";
    }

    const response = await this.axiosInstance.get("/search/records/_search", {
      params: searchParams,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response.data, null, 2),
        },
      ],
    };
  }

  private async getRecord(args: any) {
    const { uuid, approved = true } = args;
    const response = await this.axiosInstance.get(`/records/${uuid}`, {
      params: { approved },
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response.data, null, 2),
        },
      ],
    };
  }

  private async getRecordFormatters(args: any) {
    const { uuid } = args;
    const response = await this.axiosInstance.get(
      `/records/${uuid}/formatters`
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response.data, null, 2),
        },
      ],
    };
  }

  private async exportRecord(args: any) {
    const { uuid, formatter } = args;
    const response = await this.axiosInstance.get(
      `/records/${uuid}/formatters/${formatter}`,
      {
        responseType: "text",
      }
    );

    return {
      content: [
        {
          type: "text",
          text: response.data,
        },
      ],
    };
  }

  private async listGroups(args: any) {
    const { withReservedGroup = false } = args;
    const response = await this.axiosInstance.get("/groups", {
      params: { withReservedGroup },
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response.data, null, 2),
        },
      ],
    };
  }

  private async getSources() {
    const response = await this.axiosInstance.get("/sources");

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response.data, null, 2),
        },
      ],
    };
  }

  private async getSiteInfo() {
    const response = await this.axiosInstance.get("/site");

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response.data, null, 2),
        },
      ],
    };
  }

  private async getRelatedRecords(args: any) {
    const { uuid, type } = args;
    const endpoint = type
      ? `/related/${uuid}?type=${type}`
      : `/related/${uuid}`;
    const response = await this.axiosInstance.get(endpoint);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response.data, null, 2),
        },
      ],
    };
  }

  private async getTags() {
    const response = await this.axiosInstance.get("/tags");

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response.data, null, 2),
        },
      ],
    };
  }

  private async getRegions(args: any) {
    const { categoryId } = args;
    const response = await this.axiosInstance.get("/regions", {
      params: categoryId ? { categoryId } : {},
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response.data, null, 2),
        },
      ],
    };
  }

  private async searchByExtent(args: any) {
    const { minx, miny, maxx, maxy, relation = "intersects" } = args;

    const response = await this.axiosInstance.get("/search/records/_search", {
      params: {
        geometry: `${minx},${miny},${maxx},${maxy}`,
        relation,
      },
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response.data, null, 2),
        },
      ],
    };
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("EEA SDI Catalogue MCP Server running on stdio");
  }
}

const server = new EEACatalogueServer();
server.run().catch(console.error);
