#!/usr/bin/env node

import express, { Request, Response } from "express";
import cors from "cors";
import axios, { AxiosInstance } from "axios";

const BASE_URL = "https://galliwasp.eea.europa.eu/catalogue/srv/api";
const PORT = process.env.PORT || 3001;

interface EEACatalogueConfig {
  baseUrl: string;
  portal: string;
}

class EEACatalogueHTTPServer {
  private app: express.Application;
  private axiosInstance: AxiosInstance;
  private config: EEACatalogueConfig;

  constructor() {
    this.config = {
      baseUrl: BASE_URL,
      portal: "eng",
    };

    this.app = express();

    // Middleware
    this.app.use(cors());
    this.app.use(express.json());

    this.axiosInstance = axios.create({
      baseURL: this.config.baseUrl,
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });

    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    // Global error handler
    this.app.use((err: any, req: Request, res: Response, next: any) => {
      console.error("[Server Error]", err);
      res.status(500).json({
        error: err.message,
        details: err.response?.data || null
      });
    });

    process.on("SIGINT", () => {
      console.log("\nShutting down server...");
      process.exit(0);
    });
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get("/health", (req, res) => {
      res.json({ status: "ok", service: "eea-sdi-catalogue-api" });
    });

    // List all available tools/endpoints
    this.app.get("/tools", (req, res) => {
      res.json({
        tools: [
          {
            name: "search_records",
            method: "POST",
            path: "/api/search",
            description: "Search for metadata records in the EEA catalogue. Supports full Elasticsearch query syntax.",
            parameters: {
              query: "string - Search query text (searches across all fields)",
              from: "number - Starting position for results (default: 0)",
              size: "number - Number of results to return (default: 10, max: 100)",
              bucket: "string - Filter by specific facet bucket",
              sortBy: "string - Field to sort by (e.g., 'resourceTitleObject.default.sort')",
              sortOrder: "string - Sort order ('asc' or 'desc')"
            }
          },
          {
            name: "get_record",
            method: "GET",
            path: "/api/records/:uuid",
            description: "Get detailed metadata for a specific record by its UUID or ID",
            parameters: {
              uuid: "string (required) - The UUID or ID of the metadata record",
              approved: "boolean - Only return approved versions (default: true)"
            }
          },
          {
            name: "get_record_formatters",
            method: "GET",
            path: "/api/records/:uuid/formatters",
            description: "Get available formatters (export formats) for a metadata record"
          },
          {
            name: "export_record",
            method: "GET",
            path: "/api/records/:uuid/export/:formatter",
            description: "Export a metadata record in a specific format (XML, PDF, etc.)"
          },
          {
            name: "list_groups",
            method: "GET",
            path: "/api/groups",
            description: "List all groups in the catalogue",
            parameters: {
              withReservedGroup: "boolean - Include reserved system groups (default: false)"
            }
          },
          {
            name: "get_sources",
            method: "GET",
            path: "/api/sources",
            description: "Get information about catalogue sources (sub-portals)"
          },
          {
            name: "get_site_info",
            method: "GET",
            path: "/api/site",
            description: "Get general information about the catalogue site configuration"
          },
          {
            name: "get_related_records",
            method: "GET",
            path: "/api/records/:uuid/related",
            description: "Get records related to a specific record",
            parameters: {
              type: "string - Type of relationship (e.g., 'children', 'parent', 'services', 'datasets', 'sources', 'associated')"
            }
          },
          {
            name: "get_tags",
            method: "GET",
            path: "/api/tags",
            description: "Get all available tags/categories in the catalogue"
          },
          {
            name: "get_regions",
            method: "GET",
            path: "/api/regions",
            description: "Get geographic regions/extents available in the catalogue",
            parameters: {
              categoryId: "string - Filter regions by category ID"
            }
          },
          {
            name: "search_by_extent",
            method: "POST",
            path: "/api/search/extent",
            description: "Search for records by geographic extent (bounding box)",
            parameters: {
              minx: "number (required) - Minimum longitude (west)",
              miny: "number (required) - Minimum latitude (south)",
              maxx: "number (required) - Maximum longitude (east)",
              maxy: "number (required) - Maximum latitude (north)",
              relation: "string - Spatial relationship ('intersects', 'within', 'contains', default: 'intersects')"
            }
          }
        ]
      });
    });

    // Search records
    this.app.post("/api/search", async (req, res, next) => {
      try {
        const result = await this.searchRecords(req.body);
        res.json(result);
      } catch (error) {
        next(error);
      }
    });

    // Get specific record
    this.app.get("/api/records/:uuid", async (req, res, next) => {
      try {
        const result = await this.getRecord({
          uuid: req.params.uuid,
          approved: req.query.approved !== 'false'
        });
        res.json(result);
      } catch (error) {
        next(error);
      }
    });

    // Get record formatters
    this.app.get("/api/records/:uuid/formatters", async (req, res, next) => {
      try {
        const result = await this.getRecordFormatters({ uuid: req.params.uuid });
        res.json(result);
      } catch (error) {
        next(error);
      }
    });

    // Export record
    this.app.get("/api/records/:uuid/export/:formatter", async (req, res, next) => {
      try {
        const result = await this.exportRecord({
          uuid: req.params.uuid,
          formatter: req.params.formatter
        });
        res.send(result);
      } catch (error) {
        next(error);
      }
    });

    // Get related records
    this.app.get("/api/records/:uuid/related", async (req, res, next) => {
      try {
        const result = await this.getRelatedRecords({
          uuid: req.params.uuid,
          type: req.query.type as string
        });
        res.json(result);
      } catch (error) {
        next(error);
      }
    });

    // List groups
    this.app.get("/api/groups", async (req, res, next) => {
      try {
        const result = await this.listGroups({
          withReservedGroup: req.query.withReservedGroup === 'true'
        });
        res.json(result);
      } catch (error) {
        next(error);
      }
    });

    // Get sources
    this.app.get("/api/sources", async (req, res, next) => {
      try {
        const result = await this.getSources();
        res.json(result);
      } catch (error) {
        next(error);
      }
    });

    // Get site info
    this.app.get("/api/site", async (req, res, next) => {
      try {
        const result = await this.getSiteInfo();
        res.json(result);
      } catch (error) {
        next(error);
      }
    });

    // Get tags
    this.app.get("/api/tags", async (req, res, next) => {
      try {
        const result = await this.getTags();
        res.json(result);
      } catch (error) {
        next(error);
      }
    });

    // Get regions
    this.app.get("/api/regions", async (req, res, next) => {
      try {
        const result = await this.getRegions({
          categoryId: req.query.categoryId as string
        });
        res.json(result);
      } catch (error) {
        next(error);
      }
    });

    // Search by extent
    this.app.post("/api/search/extent", async (req, res, next) => {
      try {
        const result = await this.searchByExtent(req.body);
        res.json(result);
      } catch (error) {
        next(error);
      }
    });
  }

  private async searchRecords(args: any) {
    const { query = "", from = 0, size = 10, bucket, sortBy, sortOrder } = args;

    const searchBody: any = {
      from,
      size: Math.min(size, 100),
    };

    if (query) {
      searchBody.query = {
        query_string: {
          query: query || "*"
        }
      };
    }

    if (bucket) {
      searchBody.bucket = bucket;
    }

    if (sortBy) {
      searchBody.sort = [
        {
          [sortBy]: {
            order: sortOrder || "asc"
          }
        }
      ];
    }

    const response = await this.axiosInstance.post("/search/records/_search", searchBody);

    return response.data;
  }

  private async getRecord(args: any) {
    const { uuid, approved = true } = args;
    // Use search endpoint to get record in index format (with resourceTitleObject, etc.)
    const searchBody = {
      query: {
        ids: {
          values: [uuid]
        }
      },
      size: 1
    };

    const response = await this.axiosInstance.post('/search/records/_search', searchBody);

    if (response.data.hits?.hits?.length > 0) {
      return response.data.hits.hits[0]._source;
    }

    throw new Error(`Record ${uuid} not found`);
  }

  private async getRecordFormatters(args: any) {
    const { uuid } = args;
    const response = await this.axiosInstance.get(
      `/records/${uuid}/formatters`
    );

    return response.data;
  }

  private async exportRecord(args: any) {
    const { uuid, formatter } = args;
    const response = await this.axiosInstance.get(
      `/records/${uuid}/formatters/${formatter}`,
      {
        responseType: "text",
      }
    );

    return response.data;
  }

  private async listGroups(args: any) {
    const { withReservedGroup = false } = args;
    const response = await this.axiosInstance.get("/groups", {
      params: { withReservedGroup },
    });

    return response.data;
  }

  private async getSources() {
    const response = await this.axiosInstance.get("/sources");
    return response.data;
  }

  private async getSiteInfo() {
    const response = await this.axiosInstance.get("/site");
    return response.data;
  }

  private async getRelatedRecords(args: any) {
    const { uuid, type } = args;
    const endpoint = type
      ? `/related/${uuid}?type=${type}`
      : `/related/${uuid}`;
    const response = await this.axiosInstance.get(endpoint);

    return response.data;
  }

  private async getTags() {
    const response = await this.axiosInstance.get("/tags");
    return response.data;
  }

  private async getRegions(args: any) {
    const { categoryId } = args;
    const response = await this.axiosInstance.get("/regions", {
      params: categoryId ? { categoryId } : {},
    });

    return response.data;
  }

  private async searchByExtent(args: any) {
    const { minx, miny, maxx, maxy, relation = "intersects" } = args;

    const response = await this.axiosInstance.get("/search/records/_search", {
      params: {
        geometry: `${minx},${miny},${maxx},${maxy}`,
        relation,
      },
    });

    return response.data;
  }

  start(): void {
    this.app.listen(PORT, () => {
      console.log(`EEA SDI Catalogue HTTP API Server running on http://localhost:${PORT}`);
      console.log(`Available endpoints:`);
      console.log(`  GET  http://localhost:${PORT}/health - Health check`);
      console.log(`  GET  http://localhost:${PORT}/tools - List all available endpoints`);
      console.log(`  POST http://localhost:${PORT}/api/search - Search records`);
      console.log(`  GET  http://localhost:${PORT}/api/records/:uuid - Get record details`);
      console.log(`  ... and more (see /tools for full list)`);
    });
  }
}

const server = new EEACatalogueHTTPServer();
server.start();
