#!/usr/bin/env node

import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import express, { Request, Response } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { tools } from "./tools.js";
import { ToolHandlers } from "./handlers.js";

const CONFIG = {
  BASE_URL: process.env.BASE_URL,
  PORT: process.env.PORT || 3001,
  TIMEOUT: 30000,
  MAX_SEARCH_RESULTS: parseInt(process.env.MAX_SEARCH_RESULTS||"", 10),
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "", 10),
  RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "", 10),
  // Authentication for protected endpoints
  CATALOGUE_USERNAME: process.env.CATALOGUE_USERNAME || "",
  CATALOGUE_PASSWORD: process.env.CATALOGUE_PASSWORD || "",
} as const;

class SdiCatalogueServer {
  private server: Server;
  private app: express.Application;
  private handlers: ToolHandlers;

  constructor() {
    this.server = new Server(
      {
        name: "eea-sdi-catalogue",
        version: "2.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.app = express();
    this.setupExpress();

    // Build headers with optional authentication
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    // Add Basic Auth if credentials are configured
    if (CONFIG.CATALOGUE_USERNAME && CONFIG.CATALOGUE_PASSWORD) {
      const auth = Buffer.from(`${CONFIG.CATALOGUE_USERNAME}:${CONFIG.CATALOGUE_PASSWORD}`).toString("base64");
      headers.Authorization = `Basic ${auth}`;
      console.log(`[Auth] Using Basic Auth for user: ${CONFIG.CATALOGUE_USERNAME}`);
    }

    const axiosInstance = axios.create({
      baseURL: CONFIG.BASE_URL,
      headers,
      timeout: CONFIG.TIMEOUT,
    });

    this.handlers = new ToolHandlers(axiosInstance, {
      maxSearchResults: CONFIG.MAX_SEARCH_RESULTS,
      username: CONFIG.CATALOGUE_USERNAME,
      password: CONFIG.CATALOGUE_PASSWORD,
    });

    this.setupHandlers();
    this.setupErrorHandling();
    this.setupHTTPRoutes();
  }

  private setupExpress(): void {
    // Rate limiting middleware
    const limiter = rateLimit({
      windowMs: CONFIG.RATE_LIMIT_WINDOW_MS,
      max: CONFIG.RATE_LIMIT_MAX_REQUESTS,
      message: { error: "Too many requests, please try again later" },
      standardHeaders: true,
      legacyHeaders: false,
    });
    this.app.use(limiter);

    this.app.use(
      cors({
        origin: true,
        credentials: true,
        methods: ["GET", "POST", "PUT","DELETE", "OPTIONS"],
        allowedHeaders: [
          "Content-Type",
          "Accept",
          "MCP-Protocol-Version",
          "Mcp-Session-Id",
          "Last-Event-ID",
        ],
        exposedHeaders: ["Mcp-Session-Id"],
      })
    );
    this.app.use(express.json());
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
      tools,
    }));

    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request) => await this.handleToolCall(request)
    );
  }

  private setupHTTPRoutes(): void {
    // Health check endpoint
    this.app.get("/health", (_req, res) => {
      res.json({ status: "ok", service: "eea-sdi-catalogue-mcp" });
    });

    // Browser-friendly info page
    this.app.get("/info", (_req, res) => {
      res.json({
        name: "EEA SDI Catalogue MCP Server",
        version: "2.0.0",
        description: "MCP server for EEA SDI Catalogue API (GeoNetwork 4.4.9)",
        transport: "Streamable HTTP",
        endpoints: {
          mcp: "POST /",
          health: "GET /health",
          info: "GET /info",
        },
        tools: tools.map((t) => ({ name: t.name, description: t.description })),
      });
    });

    // MCP HTTP handler helper
    const handleMCPRequest = async (req: Request, res: Response, body: any = null) => {
      try {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined, // Stateless mode
          enableJsonResponse: true,
        });

        await this.server.connect(transport);
        await transport.handleRequest(req, res, body);
      } catch (error: any) {
        console.error(`[MCP Error]`, error);
        if (!res.headersSent) {
          res.status(500).json({ error: error.message });
        }
      }
    };

    // Standard MCP Streamable HTTP endpoint - POST for messages
    this.app.post("/", (req, res) => handleMCPRequest(req, res, req.body));

    // GET endpoint for SSE streams (optional, for server-initiated messages)
    this.app.get("/", (req, res) => handleMCPRequest(req, res, null));
  }

  private async handleToolCall(request: any) {
    const { name, arguments: args } = request.params;

    console.log(`[Tool] ${name}`, args);

    try {
      const toolHandlers: Record<string, () => Promise<any>> = {
        search_records: () => this.handlers.searchRecords(args),
        get_record: () => this.handlers.getRecord(args),
        get_record_formatters: () => this.handlers.getRecordFormatters(args),
        export_record: () => this.handlers.exportRecord(args),
        list_groups: () => this.handlers.listGroups(args),
        get_sources: () => this.handlers.getSources(),
        get_site_info: () => this.handlers.getSiteInfo(),
        get_related_records: () => this.handlers.getRelatedRecords(args),
        get_tags: () => this.handlers.getTags(),
        get_regions: () => this.handlers.getRegions(args),
        search_by_extent: () => this.handlers.searchByExtent(args),
        duplicate_record: () => this.handlers.duplicateRecord(args),
        update_record: () => this.handlers.updateRecord(args),
        get_record_by_id: () => this.handlers.getRecordById(args),
        update_record_title: () => this.handlers.updateRecordTitle(args),
        add_record_tags: () => this.handlers.addRecordTags(args),
        delete_record_tags: () => this.handlers.deleteRecordTags(args),
      };

      const handler = toolHandlers[name];
      if (!handler) {
        throw new Error(`Unknown tool: ${name}`);
      }

      return await handler();
    } catch (error: any) {
      const errorMessage = [
        `Error: ${error.message}`,
        error.response?.status && `Status: ${error.response.status}`,
        error.response?.data && JSON.stringify(error.response.data, null, 2),
      ]
        .filter(Boolean)
        .join("\n");

      console.error(`[Tool Error] ${name}:`, errorMessage);

      return {
        content: [{ type: "text", text: errorMessage }],
        isError: true,
      };
    }
  }

  async run(): Promise<void> {
    this.app.listen(CONFIG.PORT, () => {
      console.log(`EEA SDI Catalogue MCP Server running on http://localhost:${CONFIG.PORT}`);
      console.log(`\nEndpoints:`);
      console.log(`  GET  /health - Health check`);
      console.log(`  POST /       - MCP messages`);
      console.log(`  GET  /       - MCP SSE stream`);
      console.log(`\nConnect MCP client to: http://localhost:${CONFIG.PORT}/`);
    });
  }
}

const server = new SdiCatalogueServer();
server.run().catch(console.error);
