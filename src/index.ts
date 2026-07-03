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
import crypto from "crypto";
import { tools } from "./tools.js";
import { ToolHandlers } from "./handlers.js";
import { createSwaggerSpec, registerSwaggerDocs } from "./swagger.js";

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
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || "",
} as const;

const PORT_NUMBER =
  typeof CONFIG.PORT === "string"
    ? parseInt(CONFIG.PORT, 10) || 3001
    : CONFIG.PORT;
const DEFAULT_BASE_URL = `http://localhost:${PORT_NUMBER}`;

const pickHeaderValue = (value?: string | string[]) =>
  Array.isArray(value) ? value[0] : value;

const getPublicBaseUrl = (req?: Request) => {
  if (CONFIG.PUBLIC_BASE_URL) {
    return CONFIG.PUBLIC_BASE_URL.replace(/\/$/, "");
  }

  if (req) {
    const forwardedProto = pickHeaderValue(req.headers["x-forwarded-proto"]);
    const forwardedHost = pickHeaderValue(req.headers["x-forwarded-host"]);

    const protocol =
      forwardedProto?.split(",")[0]?.trim() || req.protocol || "http";
    const host = forwardedHost || req.get("host");

    if (protocol && host) {
      return `${protocol}://${host}`;
    }
  }

  return DEFAULT_BASE_URL;
};

const buildAbsoluteUrl = (req: Request | undefined, pathname: string) => {
  const base = getPublicBaseUrl(req);
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const normalizedPath = pathname.startsWith("/")
    ? pathname.slice(1)
    : pathname;
  return new URL(normalizedPath, normalizedBase).toString();
};

const swaggerSpec = createSwaggerSpec(getPublicBaseUrl());

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

// In-memory upload for the /attach flow (Bridge A): the file is streamed
// straight to GeoNetwork and never written to disk, so there is nothing to
// clean up afterwards.
const attachUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: CONFIG.MAX_FILE_SIZE,
  },
});

// Short-lived tickets that bind a browser upload page to a specific record.
// The agent mints a ticket (knows the record from the conversation); the user
// supplies the bytes via the browser (which is good at moving local files).
interface UploadTicket {
  metadataUuid: string;
  visibility: "PUBLIC" | "PRIVATE";
  approved: boolean;
  expiresAt: number;
}
const uploadTickets = new Map<string, UploadTicket>();

const pruneTickets = () => {
  const now = Date.now();
  for (const [token, ticket] of uploadTickets) {
    if (ticket.expiresAt <= now) uploadTickets.delete(token);
  }
};

const createUploadTicket = (
  metadataUuid: string,
  visibility: "PUBLIC" | "PRIVATE",
  approved: boolean,
  expiresInMinutes: number
): { token: string; expiresAt: number } => {
  pruneTickets();
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + expiresInMinutes * 60 * 1000;
  uploadTickets.set(token, { metadataUuid, visibility, approved, expiresAt });
  return { token, expiresAt };
};

const getValidTicket = (token?: string): UploadTicket | null => {
  if (!token) return null;
  const ticket = uploadTickets.get(token);
  if (!ticket) return null;
  if (ticket.expiresAt <= Date.now()) {
    uploadTickets.delete(token);
    return null;
  }
  return ticket;
};

// Periodically sweep the legacy disk basket (/upload) so old files don't pile
// up. The /attach flow never writes here. Default: remove files older than 24h.
const UPLOAD_TTL_MS = parseInt(process.env.UPLOAD_TTL_MS || "", 10) || 24 * 60 * 60 * 1000;
const sweepUploadDir = () => {
  fs.readdir(CONFIG.UPLOAD_DIR, (err, files) => {
    if (err) return;
    const cutoff = Date.now() - UPLOAD_TTL_MS;
    for (const name of files) {
      const filepath = path.join(CONFIG.UPLOAD_DIR, name);
      fs.stat(filepath, (statErr, stats) => {
        if (statErr || !stats.isFile()) return;
        if (stats.mtimeMs < cutoff) {
          fs.unlink(filepath, () => console.log(`[Cleanup] Removed stale basket file: ${name}`));
        }
      });
    }
  });
};
setInterval(sweepUploadDir, 60 * 60 * 1000).unref();
setInterval(pruneTickets, 10 * 60 * 1000).unref();

class GeoNetworkMcpServer {
  private app: express.Application;
  private handlers: ToolHandlers;

  constructor() {
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
    process.on("SIGINT", () => {
      process.exit(0);
    });
  }

  private setupHTTPRoutes(): void {
    // Swagger UI documentation
    registerSwaggerDocs(this.app, swaggerSpec);

    // Health check endpoint
    this.app.get("/health", (_req, res) => {
      res.json({ status: "ok", service: "eea-geonetwork-mcp" });
    });

    // Browser-friendly info page
    this.app.get("/info", (_req, res) => {
      res.json({
        name: "EEA GeoNetwork MCP Server",
        version: "2.0.0",
        description: "MCP server for EEA GeoNetwork Catalogue API (GeoNetwork 4.4.9)",
        transport: "Streamable HTTP",
        endpoints: {
          mcp: "POST /",
          health: "GET /health",
          info: "GET /info",
          swagger: "GET /api-docs",
          playground: "GET /playground",
          upload: "POST /upload",
          uploads: "GET /uploads/:filename",
          attach: "GET /attach?token=... (file-upload page bound to a record)",
        },
        tools: tools.map((t) => ({ name: t.name, description: t.description })),
      });
    });

    // MCP Playground - interactive tool tester
    this.app.get("/playground", (_req, res) => {
      const toolsData = JSON.stringify(tools);
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EEA GeoNetwork MCP Playground</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',sans-serif;background:#0f1117;color:#e2e8f0;min-height:100vh;display:flex;flex-direction:column}
    header{background:#1a1d2e;border-bottom:1px solid #2d3748;padding:16px 24px;display:flex;align-items:center;gap:12px}
    header h1{font-size:1.2rem;font-weight:600;color:#fff}
    header span{background:#2d6a4f;color:#95d5b2;font-size:0.75rem;padding:2px 8px;border-radius:12px}
    .layout{display:grid;grid-template-columns:320px 1fr;flex:1;overflow:hidden;height:calc(100vh - 57px)}
    .sidebar{background:#161925;border-right:1px solid #2d3748;display:flex;flex-direction:column;overflow:hidden}
    .sidebar-header{padding:16px;border-bottom:1px solid #2d3748;font-size:0.8rem;color:#718096;text-transform:uppercase;letter-spacing:.05em}
    .tool-list{overflow-y:auto;flex:1}
    .tool-item{padding:12px 16px;cursor:pointer;border-bottom:1px solid #1e2333;transition:background .15s}
    .tool-item:hover{background:#1e2333}
    .tool-item.active{background:#1a2744;border-left:3px solid #4299e1}
    .tool-item .name{font-size:0.85rem;font-weight:600;color:#90cdf4;font-family:monospace}
    .tool-item .desc{font-size:0.75rem;color:#718096;margin-top:3px;line-height:1.4}
    .main{display:flex;flex-direction:column;overflow:hidden}
    .top-pane{display:flex;flex-direction:column;border-bottom:1px solid #2d3748;padding:16px;gap:12px;min-height:200px}
    .pane-label{font-size:0.75rem;color:#718096;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
    textarea{width:100%;background:#0d1117;border:1px solid #2d3748;border-radius:6px;color:#e2e8f0;font-family:'Courier New',monospace;font-size:0.85rem;padding:12px;resize:vertical;min-height:120px;outline:none;transition:border .15s}
    textarea:focus{border-color:#4299e1}
    .actions{display:flex;gap:8px;align-items:center}
    button.run{background:#2b6cb0;color:#fff;border:none;padding:8px 20px;border-radius:6px;font-size:0.85rem;cursor:pointer;font-weight:600;transition:background .15s}
    button.run:hover{background:#2c5282}
    button.run:disabled{background:#4a5568;cursor:not-allowed}
    button.clear{background:transparent;color:#718096;border:1px solid #2d3748;padding:8px 16px;border-radius:6px;font-size:0.85rem;cursor:pointer;transition:all .15s}
    button.clear:hover{border-color:#718096;color:#e2e8f0}
    .status{font-size:0.8rem;color:#718096}
    .status.ok{color:#68d391}
    .status.err{color:#fc8181}
    .bottom-pane{flex:1;display:flex;flex-direction:column;padding:16px;overflow:hidden}
    .response-box{flex:1;overflow:auto;background:#0d1117;border:1px solid #2d3748;border-radius:6px;padding:12px;font-family:'Courier New',monospace;font-size:0.8rem;white-space:pre;line-height:1.6}
    .s{color:#68d391}.n{color:#f6e05e}.b{color:#fc8181}.k{color:#90cdf4}.null{color:#a0aec0}
    .schema-hint{background:#1a1d2e;border:1px solid #2d3748;border-radius:6px;padding:10px 12px;font-size:0.75rem;color:#a0aec0;line-height:1.6}
    .schema-hint code{color:#90cdf4;font-family:monospace}
    .required-badge{color:#fc8181;font-size:0.7rem;margin-left:4px}
  </style>
</head>
<body>
  <header>
    <h1>EEA GeoNetwork MCP Playground</h1>
    <span>MCP Tools</span>
  </header>
  <div class="layout">
    <div class="sidebar">
      <div class="sidebar-header">Tools (${tools.length})</div>
      <div class="tool-list" id="toolList"></div>
    </div>
    <div class="main">
      <div class="top-pane">
        <div>
          <div class="pane-label">Parameters (JSON)</div>
          <textarea id="params" spellcheck="false" placeholder="Select a tool to get started..."></textarea>
        </div>
        <div id="schemaHint" class="schema-hint" style="display:none"></div>
        <div class="actions">
          <button class="run" id="runBtn" onclick="runTool()" disabled>Run</button>
          <button class="clear" onclick="clearResponse()">Clear</button>
          <span class="status" id="status"></span>
        </div>
      </div>
      <div class="bottom-pane">
        <div class="pane-label">Response</div>
        <div class="response-box" id="response"><span style="color:#4a5568">// Response will appear here</span></div>
      </div>
    </div>
  </div>
  <script>
    const TOOLS = ${toolsData};
    let selectedTool = null;

    function buildDefaultParams(schema) {
      if (!schema || !schema.properties) return {};
      const out = {};
      for (const [k, v] of Object.entries(schema.properties)) {
        if (schema.required && schema.required.includes(k)) {
          if (v.type === 'string') out[k] = v.default ?? '';
          else if (v.type === 'number') out[k] = v.default ?? 0;
          else if (v.type === 'boolean') out[k] = v.default ?? true;
          else if (v.type === 'array') out[k] = [];
        } else if (v.default !== undefined) {
          out[k] = v.default;
        }
      }
      return out;
    }

    function buildSchemaHint(schema) {
      if (!schema || !schema.properties) return '';
      const rows = Object.entries(schema.properties).map(([k, v]) => {
        const req = schema.required && schema.required.includes(k);
        const type = v.enum ? v.enum.join(' | ') : v.type || 'any';
        const desc = v.description || '';
        return \`<div><code>\${k}</code><span class="required-badge">\${req ? '* required' : ''}</span> <em>\${type}</em> — \${desc}</div>\`;
      });
      return rows.join('');
    }

    function selectTool(name) {
      selectedTool = TOOLS.find(t => t.name === name);
      document.querySelectorAll('.tool-item').forEach(el => el.classList.toggle('active', el.dataset.name === name));
      const defaults = buildDefaultParams(selectedTool.inputSchema);
      document.getElementById('params').value = JSON.stringify(defaults, null, 2);
      const hint = buildSchemaHint(selectedTool.inputSchema);
      const hintEl = document.getElementById('schemaHint');
      if (hint) { hintEl.innerHTML = hint; hintEl.style.display = 'block'; }
      else hintEl.style.display = 'none';
      document.getElementById('runBtn').disabled = false;
      document.getElementById('response').innerHTML = '<span style="color:#4a5568">// Ready</span>';
      document.getElementById('status').textContent = '';
    }

    function highlight(json) {
      return json
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\\s*:)?|\\b(true|false|null)\\b|-?\\d+(?:\\.\\d*)?(?:[eE][+\\-]?\\d+)?)/g, m => {
          if (/^"/.test(m)) return /:$/.test(m) ? \`<span class="k">\${m}</span>\` : \`<span class="s">\${m}</span>\`;
          if (/true|false/.test(m)) return \`<span class="b">\${m}</span>\`;
          if (/null/.test(m)) return \`<span class="null">\${m}</span>\`;
          return \`<span class="n">\${m}</span>\`;
        });
    }

    async function runTool() {
      if (!selectedTool) return;
      let params;
      try { params = JSON.parse(document.getElementById('params').value || '{}'); }
      catch(e) { setStatus('Invalid JSON: ' + e.message, true); return; }
      const btn = document.getElementById('runBtn');
      btn.disabled = true; btn.textContent = 'Running…';
      setStatus('Calling ' + selectedTool.name + '…', false);
      const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: selectedTool.name, arguments: params } };
      const t0 = Date.now();
      try {
        const resp = await fetch('/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-03-26' }, body: JSON.stringify(body) });
        const text = await resp.text();
        const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
        let display;
        try {
          const json = JSON.parse(text);
          // Extract the tool result content text if present
          const content = json?.result?.content;
          if (content && content[0]?.text) {
            try { display = JSON.stringify(JSON.parse(content[0].text), null, 2); }
            catch { display = content[0].text; }
          } else {
            display = JSON.stringify(json, null, 2);
          }
          const isErr = json?.result?.isError;
          setStatus((isErr ? 'Error' : 'OK') + ' — ' + elapsed + 's', isErr);
        } catch { display = text; setStatus('Raw — ' + elapsed + 's', false); }
        document.getElementById('response').innerHTML = highlight(display);
      } catch(e) {
        setStatus('Request failed: ' + e.message, true);
        document.getElementById('response').textContent = e.message;
      } finally { btn.disabled = false; btn.textContent = 'Run'; }
    }

    function setStatus(msg, isErr) {
      const el = document.getElementById('status');
      el.textContent = msg; el.className = 'status ' + (isErr ? 'err' : 'ok');
    }

    function clearResponse() {
      document.getElementById('response').innerHTML = '<span style="color:#4a5568">// Cleared</span>';
      document.getElementById('status').textContent = '';
    }

    // Populate tool list
    const list = document.getElementById('toolList');
    TOOLS.forEach(t => {
      const el = document.createElement('div');
      el.className = 'tool-item'; el.dataset.name = t.name;
      el.innerHTML = \`<div class="name">\${t.name}</div><div class="desc">\${t.description}</div>\`;
      el.onclick = () => selectTool(t.name);
      list.appendChild(el);
    });

    // Keyboard shortcut: Ctrl+Enter to run
    document.getElementById('params').addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') runTool();
    });
  </script>
</body>
</html>`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    });

    // Upload basket endpoint - accepts file uploads
    this.app.post("/upload", upload.single("file"), (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No file uploaded" });
        }

        const fileUrl = buildAbsoluteUrl(req, `/uploads/${req.file.filename}`);

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

    // Bridge A: the upload page bound to a record via a short-lived ticket.
    this.app.get("/attach", (req, res) => {
      const token = pickHeaderValue(req.query.token as string | string[] | undefined);
      const ticket = getValidTicket(token);

      res.setHeader("Content-Type", "text/html; charset=utf-8");

      if (!ticket) {
        res.status(404).send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Upload link expired</title>
<style>body{font-family:'Segoe UI',sans-serif;background:#0f1117;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#161925;border:1px solid #2d3748;border-radius:10px;padding:32px;max-width:420px;text-align:center}
h1{font-size:1.1rem;margin:0 0 8px}p{color:#a0aec0;font-size:0.9rem;line-height:1.5}</style></head>
<body><div class="card"><h1>Link expired or invalid</h1><p>Ask the assistant to generate a new upload link with <code>create_upload_link</code>.</p></div></body></html>`);
        return;
      }

      res.send(`<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Attach file to record</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',sans-serif;background:#0f1117;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#161925;border:1px solid #2d3748;border-radius:10px;padding:28px;width:480px;max-width:92vw}
h1{font-size:1.15rem;margin-bottom:4px}
.uuid{font-family:monospace;color:#90cdf4;font-size:0.8rem;word-break:break-all;margin-bottom:18px}
.drop{border:2px dashed #2d3748;border-radius:8px;padding:36px 16px;text-align:center;color:#718096;cursor:pointer;transition:border .15s,background .15s}
.drop.over{border-color:#4299e1;background:#1a2744;color:#90cdf4}
.drop strong{color:#e2e8f0}
.file{margin-top:14px;font-size:0.85rem;color:#a0aec0}
button{margin-top:18px;width:100%;background:#2b6cb0;color:#fff;border:none;padding:11px;border-radius:6px;font-size:0.9rem;font-weight:600;cursor:pointer;transition:background .15s}
button:hover:not(:disabled){background:#2c5282}
button:disabled{background:#4a5568;cursor:not-allowed}
.status{margin-top:14px;font-size:0.85rem;min-height:20px}
.status.ok{color:#68d391}.status.err{color:#fc8181}.status.busy{color:#f6e05e}
input[type=file]{display:none}
</style></head>
<body>
<div class="card">
  <h1>Attach a file</h1>
  <div class="uuid">Record: ${ticket.metadataUuid}</div>
  <label class="drop" id="drop">
    <input type="file" id="file">
    <div><strong>Click to choose</strong> or drag a file here</div>
  </label>
  <div class="file" id="fileName"></div>
  <button id="btn" disabled>Attach to record</button>
  <div class="status" id="status"></div>
</div>
<script>
  const TOKEN = ${JSON.stringify(token)};
  const drop = document.getElementById('drop');
  const input = document.getElementById('file');
  const btn = document.getElementById('btn');
  const fileName = document.getElementById('fileName');
  const status = document.getElementById('status');
  let chosen = null;

  function setFile(f){ chosen = f; fileName.textContent = f ? (f.name + ' (' + (f.size/1024).toFixed(0) + ' KB)') : ''; btn.disabled = !f; }
  input.addEventListener('change', () => setFile(input.files[0]));
  ['dragenter','dragover'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add('over'); }));
  ['dragleave','drop'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', ev => { if (ev.dataTransfer.files[0]) setFile(ev.dataTransfer.files[0]); });

  btn.addEventListener('click', async () => {
    if (!chosen) return;
    btn.disabled = true;
    status.className = 'status busy'; status.textContent = 'Uploading…';
    const fd = new FormData(); fd.append('file', chosen);
    try {
      const resp = await fetch('/attach?token=' + encodeURIComponent(TOKEN), { method: 'POST', body: fd });
      const data = await resp.json();
      if (resp.ok && data.success) {
        status.className = 'status ok'; status.textContent = '✓ ' + (data.message || 'Attached');
        setFile(null); input.value = '';
      } else {
        status.className = 'status err'; status.textContent = 'Error: ' + (data.error || resp.statusText);
        btn.disabled = false;
      }
    } catch (e) {
      status.className = 'status err'; status.textContent = 'Request failed: ' + e.message;
      btn.disabled = false;
    }
  });
</script>
</body></html>`);
    });

    // Receives the file from the /attach page and pushes it straight to
    // GeoNetwork. The buffer lives only in memory — nothing is written to disk.
    this.app.post("/attach", attachUpload.single("file"), async (req, res) => {
      const token = pickHeaderValue(req.query.token as string | string[] | undefined);
      const ticket = getValidTicket(token);

      if (!ticket) {
        return res.status(403).json({ error: "Upload link expired or invalid" });
      }
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      try {
        const filename = req.file.originalname;
        const contentType = req.file.mimetype || "application/octet-stream";
        console.log(`[Attach] ${filename} (${req.file.size} bytes) -> record ${ticket.metadataUuid}`);

        const resource = await this.handlers.attachBufferToRecord(
          ticket.metadataUuid,
          req.file.buffer,
          filename,
          contentType,
          ticket.visibility,
          ticket.approved
        );

        res.json({
          success: true,
          message: `"${filename}" attached to record ${ticket.metadataUuid}`,
          resource,
        });
      } catch (error: any) {
        const errorData = error.response?.data;
        const errorStatus = error.response?.status;
        console.error(`[Attach Error] status=${errorStatus}`, errorData || error.message);
        if (errorStatus === 500 && errorData?.message === "Access Denied") {
          return res.status(403).json({
            error: "Access Denied — the record may be published/approved or you lack edit permissions. Try duplicating it to a draft first.",
          });
        }
        res.status(500).json({ error: error.message });
      }
    });

    // MCP HTTP handler helper
    // A new Server instance is created per request because the MCP SDK only
    // allows one active transport connection per Server instance (stateless mode).
    const handleMCPRequest = async (req: Request, res: Response, body: any = null) => {
      const mcpServer = new Server(
        { name: "eea-geonetwork", version: "2.0.0" },
        { capabilities: { tools: {} } }
      );
      mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
      mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => await this.handleToolCall(request));

      try {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined, // Stateless mode
          enableJsonResponse: true,
        });

        res.on("finish", () => mcpServer.close().catch(() => {}));

        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, body);
      } catch (error: any) {
        console.error(`[MCP Error]`, error);
        mcpServer.close().catch(() => {});
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
      // Handled here (not in ToolHandlers) because it depends on the HTTP
      // server's public URL and the in-memory ticket store, not the GeoNetwork API.
      if (name === "create_upload_link") {
        if (!CONFIG.CATALOGUE_USERNAME || !CONFIG.CATALOGUE_PASSWORD) {
          return {
            content: [{ type: "text", text: "Error: Authentication required for create_upload_link. Set CATALOGUE_USERNAME and CATALOGUE_PASSWORD." }],
            isError: true,
          };
        }
        const metadataUuid = String(args?.metadataUuid || "");
        if (!metadataUuid) {
          return {
            content: [{ type: "text", text: "Error: metadataUuid is required." }],
            isError: true,
          };
        }
        const visibility = args?.visibility === "PRIVATE" ? "PRIVATE" : "PUBLIC";
        const approved = args?.approved === true;
        const expiresInMinutes =
          typeof args?.expiresInMinutes === "number" && args.expiresInMinutes > 0
            ? args.expiresInMinutes
            : 30;

        const { token, expiresAt } = createUploadTicket(metadataUuid, visibility, approved, expiresInMinutes);
        const url = buildAbsoluteUrl(undefined, `/attach?token=${token}`);

        return {
          content: [{
            type: "text",
            text: [
              `Upload link ready for record ${metadataUuid}:`,
              url,
              ``,
              `Open it in a browser, drag in the file, and it will be attached directly to the record.`,
              `The link is valid until ${new Date(expiresAt).toISOString()} (${expiresInMinutes} min).`,
            ].join("\n"),
          }],
        };
      }

      const toolHandlers: Record<string, () => Promise<any>> = {
        search_records: () => this.handlers.searchRecords(args),
        get_record: () => this.handlers.getRecord(args),
        get_record_summary: () => this.handlers.getRecordSummary(args),
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
        upload_base64_to_record: () => this.handlers.uploadBase64ToRecord(args),
        upload_url_to_record: () => this.handlers.uploadUrlToRecord(args),
        process_record: () => this.handlers.processRecord(args),
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
    this.app.listen(PORT_NUMBER, () => {
      const publicBaseUrl = getPublicBaseUrl();
      console.log(`EEA GeoNetwork MCP Server running on ${publicBaseUrl}`);
      console.log(`\nEndpoints:`);
      console.log(`  GET  ${buildAbsoluteUrl(undefined, "/health")}          - Health check`);
      console.log(`  GET  ${buildAbsoluteUrl(undefined, "/info")}            - Server information`);
      console.log(`  GET  ${buildAbsoluteUrl(undefined, "/api-docs")}        - Swagger UI (file upload interface)`);
      console.log(`  GET  ${buildAbsoluteUrl(undefined, "/playground")}     - MCP Tool Playground`);
      console.log(`  POST ${buildAbsoluteUrl(undefined, "/upload")}          - Upload file to basket`);
      console.log(`  GET  ${buildAbsoluteUrl(undefined, "/uploads/:file")}   - Retrieve uploaded file`);
      console.log(`  POST ${buildAbsoluteUrl(undefined, "/")}                - MCP messages`);
      console.log(`  GET  ${buildAbsoluteUrl(undefined, "/")}                - MCP SSE stream`);
      console.log(`\nUpload basket:`);
      console.log(`  Directory: ${CONFIG.UPLOAD_DIR}`);
      console.log(`  Max file size: ${(CONFIG.MAX_FILE_SIZE / 1024 / 1024).toFixed(0)}MB`);
      console.log(`  Swagger UI: ${buildAbsoluteUrl(undefined, "/api-docs")}`);
      console.log(`\nConnect MCP client to: ${buildAbsoluteUrl(undefined, "/")}`);
    });
  }
}

const server = new GeoNetworkMcpServer();
server.run().catch(console.error);
