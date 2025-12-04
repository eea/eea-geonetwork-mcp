# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an MCP (Model Context Protocol) server that provides tools to interact with the EEA GeoNetwork Catalogue API (GeoNetwork 4.4.9). The server exposes 20 tools for searching, retrieving, duplicating, and exporting geospatial metadata records from the European Environment Agency's GeoNetwork catalogue.

## Development Commands

### Build and Run
```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to dist/
npm run dev          # Watch mode (recompile on changes)
npm start            # Run the Streamable HTTP MCP server (port 3001)
```

### Development Workflow
For active development, run two commands in separate terminals:
- **Terminal 1**: `npm run dev` - Compile TypeScript in watch mode
- **Terminal 2**: `npm start` - Run the server

### Server Implementation

The server uses the official MCP protocol via Streamable HTTP transport (standard MCP HTTP/SSE):

**Streamable HTTP MCP Server** (src/index.ts) - Official MCP protocol via Streamable HTTP
- Runs on port 3001 by default (configurable via `PORT` environment variable or `.env` file)
- Connect MCP clients to: `http://localhost:3001/`
- Uses stateless mode (no session management required)
- Endpoints:
  - `POST /` - Standard MCP message endpoint (handles JSON-RPC messages)
  - `GET /` - Optional SSE stream endpoint (for server-initiated messages)
  - `GET /health` - Health check

## Architecture

### Core Components

**src/index.ts** - Streamable HTTP MCP server implementation:
- `EEACatalogueServer` class: Main server logic
- `CONFIG` constant: Centralized configuration (BASE_URL, PORT, TIMEOUT)
- Streamable HTTP transport for MCP protocol (stateless mode)
- Express server setup with CORS and JSON middleware
- MCP request handlers: ListTools and CallTool
- Tool routing via object-based handler lookup (no switch statements)
- Centralized error handling with formatted error messages

**src/tools.ts** - Tool definitions:
- Array of 20 tool definitions with JSON schemas
- Each tool specifies name, description, and input schema

**src/handlers.ts** - Tool implementation handlers:
- `ToolHandlers` class with Axios instance
- `formatResponse()` helper for consistent response formatting
- 20 async handler methods with explicit return types
- Simplified parameter building using object spread with conditionals

**src/types.ts** - TypeScript interfaces:
- `ToolResponse` interface for handler return values
- Argument interfaces for all 20 tools (SearchRecordsArgs, GetRecordArgs, etc.)

### API Integration

**Base URL**: `https://galliwasp.eea.europa.eu/catalogue/srv/api` (Sandbox)

The server uses axios to communicate with the GeoNetwork REST API. All requests:
- Accept JSON responses
- Have a 30-second timeout
- Use the default portal ("eng")

### Tool Categories

1. **Search Tools**: `search_records`, `search_by_extent`
2. **Record Tools**: `get_record`, `get_related_records`, `get_record_formatters`, `export_record`, `duplicate_record`
3. **Catalogue Tools**: `get_site_info`, `get_sources`, `list_groups`, `get_tags`, `get_regions`

### Error Handling

All tool calls are wrapped in try-catch blocks. Errors return:
- Error message
- API response data (if available)
- `isError: true` flag

## Key Implementation Details

### Tool Call Pattern
Each tool follows this pattern:
1. Extract and validate arguments
2. Build API request (URL/params)
3. Make axios request
4. Return formatted response with `content` array

### Response Format
All successful responses return:
```typescript
{
  content: [
    {
      type: "text",
      text: JSON.stringify(data, null, 2)
    }
  ]
}
```

### Search Implementation
The `search_records` tool:
- Uses `/search/records/_search` endpoint
- Supports Elasticsearch query syntax via `any` parameter
- Limits results to max 100 per request
- Supports sorting and facet filtering

### Export Functionality
Records can be exported in multiple formats:
1. Call `get_record_formatters` to list available formats
2. Call `export_record` with the chosen formatter ID
3. Returns raw formatted output (XML, HTML, etc.)

## Adding New Tools

To add a new tool:

1. **Define the tool arguments interface** in `src/types.ts`:
```typescript
export interface MyNewToolArgs {
  param1: string;
  param2?: number;
}
```

2. **Add tool definition** to the `tools` array in `src/tools.ts`:
```typescript
{
  name: "my_new_tool",
  description: "Description of what the tool does",
  inputSchema: {
    type: "object",
    properties: {
      param1: { type: "string", description: "Parameter description" },
      param2: { type: "number", description: "Optional parameter" }
    },
    required: ["param1"]
  }
}
```

3. **Implement the handler method** in `src/handlers.ts` (ToolHandlers class):
```typescript
async myNewTool(args: MyNewToolArgs): Promise<ToolResponse> {
  const response = await this.axiosInstance.get("/endpoint", {
    params: args
  });
  return this.formatResponse(response.data);
}
```

4. **Add the handler to the routing** in `src/index.ts` (handleToolCall method):
```typescript
const toolHandlers: Record<string, () => Promise<any>> = {
  // ... existing handlers
  my_new_tool: () => this.handlers.myNewTool(args),
};
```

## API Endpoint Patterns

Common GeoNetwork endpoints used:
- `/search/records/_search` - Elasticsearch proxy for search
- `/records/{uuid}` - Get record details
- `/records/{uuid}/formatters` - List export formats
- `/records/{uuid}/formatters/{formatter}` - Export record
- `/records/duplicate` - Duplicate a metadata record
- `/related/{uuid}` - Get related records
- `/groups` - List groups
- `/sources` - List catalogue sources
- `/tags` - List tags
- `/regions` - List geographic regions
- `/site` - Site configuration

## MCP Transport

The server uses the official MCP SDK with **Streamable HTTP** transport (MCP specification 2025-06-18):

### Transport Details
- **Type**: Streamable HTTP (standard MCP HTTP/SSE)
- **Mode**: Stateless (no session management)
- **Endpoint**: Single endpoint at `/` handles both POST and GET
- **Connection URL**: `http://localhost:3001/`

### Endpoints
- `POST /` - Standard MCP message endpoint
  - Accepts JSON-RPC messages
  - Returns either JSON responses or SSE streams
  - Must include `Accept: application/json, text/event-stream` header
  - Must include `MCP-Protocol-Version` header
- `GET /` - Optional SSE stream endpoint
  - Opens Server-Sent Events stream
  - Enables server-initiated messages
  - Supports `Last-Event-ID` for resumable streams
- `GET /health` - Health check endpoint

### Protocol Compliance
- Follows MCP specification version 2025-06-18
- Supports both single JSON responses and SSE streaming
- CORS enabled with proper MCP headers
- Stateless operation (no session tracking)

## Environment Configuration

The server uses `dotenv` to load environment variables from a `.env` file:
- `PORT` - Server port (default: 3001)

Create a `.env` file in the project root:
```
PORT=3001
```

## TypeScript Configuration

- Target: ES2022
- Module: Node16 (native ES modules)
- Output: dist/ directory
- Strict mode enabled
