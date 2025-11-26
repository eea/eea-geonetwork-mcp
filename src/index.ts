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
import multer from "multer";
import path from "path";
import fs from "fs";
import swaggerUi from "swagger-ui-express";
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
  // Upload basket configuration
  UPLOAD_DIR: process.env.UPLOAD_DIR || "./uploads",
  MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE || "104857600", 10), // 100MB default
} as const;

// Ensure upload directory exists
if (!fs.existsSync(CONFIG.UPLOAD_DIR)) {
  fs.mkdirSync(CONFIG.UPLOAD_DIR, { recursive: true });
  console.log(`[Upload] Created upload directory: ${CONFIG.UPLOAD_DIR}`);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, CONFIG.UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // Generate unique filename with timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const basename = path.basename(file.originalname, ext);
    cb(null, `${basename}-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: CONFIG.MAX_FILE_SIZE
  }
});

// OpenAPI/Swagger specification
const swaggerSpec = {
  openapi: "3.0.0",
  info: {
    title: "EEA SDI Catalogue MCP Server - Upload Basket API",
    version: "2.0.0",
    description: "Upload files to the basket for use with the EEA SDI Catalogue. Upload files here, then use the returned URL with the upload_resource_from_url MCP tool to attach them to metadata records.",
    contact: {
      name: "EEA SDI Team",
    },
  },
  servers: [
    {
      url: `http://localhost:${CONFIG.PORT}`,
      description: "Local development server",
    },
  ],
  paths: {
    "/upload": {
      post: {
        summary: "Upload file to basket",
        description: "Upload a file to the temporary upload basket. Returns a URL that can be used with the upload_resource_from_url MCP tool.",
        tags: ["Upload Basket"],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  file: {
                    type: "string",
                    format: "binary",
                    description: "File to upload (max 100MB)",
                  },
                },
                required: ["file"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "File uploaded successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    message: { type: "string", example: "File uploaded successfully" },
                    file: {
                      type: "object",
                      properties: {
                        originalName: { type: "string", example: "document.pdf" },
                        filename: { type: "string", example: "document-1234567890.pdf" },
                        size: { type: "number", example: 1024 },
                        mimetype: { type: "string", example: "application/pdf" },
                        url: { type: "string", example: "http://localhost:3001/uploads/document-1234567890.pdf" },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Bad request - no file uploaded",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string", example: "No file uploaded" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/uploads/{filename}": {
      get: {
        summary: "Download uploaded file",
        description: "Retrieve a previously uploaded file from the basket",
        tags: ["Upload Basket"],
        parameters: [
          {
            name: "filename",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Filename returned from upload",
            example: "document-1234567890.pdf",
          },
        ],
        responses: {
          "200": {
            description: "File content",
            content: {
              "application/octet-stream": {
                schema: {
                  type: "string",
                  format: "binary",
                },
              },
            },
          },
          "404": {
            description: "File not found",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string", example: "File not found" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/health": {
      get: {
        summary: "Health check",
        description: "Check if the server is running",
        tags: ["System"],
        responses: {
          "200": {
            description: "Server is healthy",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "ok" },
                    service: { type: "string", example: "eea-sdi-catalogue-mcp" },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  tags: [
    {
      name: "Upload Basket",
      description: "Temporary file storage for metadata record attachments",
    },
    {
      name: "System",
      description: "System health and information endpoints",
    },
  ],
};

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
    // Swagger UI documentation
    this.app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
      customSiteTitle: "EEA SDI Upload Basket API",
      customCss: '.swagger-ui .topbar { display: none }',
    }));

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
          swagger: "GET /api-docs",
          upload: "POST /upload",
          uploads: "GET /uploads/:filename",
        },
        tools: tools.map((t) => ({ name: t.name, description: t.description })),
      });
    });

    // Upload basket endpoint - accepts file uploads
    this.app.post("/upload", upload.single("file"), (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No file uploaded" });
        }

        const fileUrl = `http://localhost:${CONFIG.PORT}/uploads/${req.file.filename}`;

        console.log(`[Upload] File uploaded: ${req.file.originalname} -> ${req.file.filename}`);
        console.log(`[Upload] Accessible at: ${fileUrl}`);

        res.json({
          success: true,
          message: "File uploaded successfully",
          file: {
            originalName: req.file.originalname,
            filename: req.file.filename,
            size: req.file.size,
            mimetype: req.file.mimetype,
            url: fileUrl,
          },
        });
      } catch (error: any) {
        console.error(`[Upload Error]`, error);
        res.status(500).json({ error: error.message });
      }
    });

    // Serve uploaded files
    this.app.get("/uploads/:filename", (req, res) => {
      const filename = req.params.filename;
      const filepath = path.join(CONFIG.UPLOAD_DIR, filename);

      // Security check - prevent directory traversal
      const resolvedPath = path.resolve(filepath);
      const uploadDirPath = path.resolve(CONFIG.UPLOAD_DIR);

      if (!resolvedPath.startsWith(uploadDirPath)) {
        return res.status(403).json({ error: "Access denied" });
      }

      if (!fs.existsSync(filepath)) {
        return res.status(404).json({ error: "File not found" });
      }

      console.log(`[Upload] Serving file: ${filename}`);
      res.sendFile(resolvedPath);
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
        get_attachments: () => this.handlers.getAttachments(args),
        delete_attachment: () => this.handlers.deleteAttachment(args),
        upload_file_to_record: () => this.handlers.uploadFileToRecord(args),
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
      console.log(`  GET  /health          - Health check`);
      console.log(`  GET  /info            - Server information`);
      console.log(`  GET  /api-docs        - Swagger UI (file upload interface)`);
      console.log(`  POST /upload          - Upload file to basket`);
      console.log(`  GET  /uploads/:file   - Retrieve uploaded file`);
      console.log(`  POST /                - MCP messages`);
      console.log(`  GET  /                - MCP SSE stream`);
      console.log(`\nUpload basket:`);
      console.log(`  Directory: ${CONFIG.UPLOAD_DIR}`);
      console.log(`  Max file size: ${(CONFIG.MAX_FILE_SIZE / 1024 / 1024).toFixed(0)}MB`);
      console.log(`  Swagger UI: http://localhost:${CONFIG.PORT}/api-docs`);
      console.log(`\nConnect MCP client to: http://localhost:${CONFIG.PORT}/`);
    });
  }
}

const server = new SdiCatalogueServer();
server.run().catch(console.error);
