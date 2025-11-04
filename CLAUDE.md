# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an MCP (Model Context Protocol) server that provides tools to interact with the EEA SDI Catalogue API (GeoNetwork 4.4.9). The server exposes 11 tools for searching, retrieving, and exporting geospatial metadata records from the European Environment Agency's Spatial Data Infrastructure catalogue.

## Development Commands

### Build and Run
```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to dist/
npm run dev          # Watch mode (recompile on changes)
npm start            # Run the compiled server
```

### Testing the Server
To test the MCP server locally, you can:
1. Build the project with `npm run build`
2. Add the server to Claude Desktop configuration (see README.md)
3. Restart Claude Desktop to load the server

## Architecture

### Core Components

**src/index.ts** - Single-file MCP server implementation containing:
- `EEACatalogueServer` class: Main server logic
- Tool definitions: 11 tools for interacting with the EEA API
- Request handlers: ListTools and CallTool handlers
- API client: Axios instance configured for the EEA catalogue

### API Integration

**Base URL**: `https://galliwasp.eea.europa.eu/catalogue/srv/api` (Sandbox)

The server uses axios to communicate with the GeoNetwork REST API. All requests:
- Accept JSON responses
- Have a 30-second timeout
- Use the default portal ("eng")

### Tool Categories

1. **Search Tools**: `search_records`, `search_by_extent`
2. **Record Tools**: `get_record`, `get_related_records`, `get_record_formatters`, `export_record`
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

1. Add tool definition to `getTools()` array with name, description, and inputSchema
2. Add case to switch statement in `handleToolCall()`
3. Implement handler method following the pattern:
```typescript
private async myNewTool(args: any) {
  const response = await this.axiosInstance.get("/endpoint", {
    params: args
  });
  return {
    content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }]
  };
}
```

## API Endpoint Patterns

Common GeoNetwork endpoints used:
- `/search/records/_search` - Elasticsearch proxy for search
- `/records/{uuid}` - Get record details
- `/records/{uuid}/formatters` - List export formats
- `/records/{uuid}/formatters/{formatter}` - Export record
- `/related/{uuid}` - Get related records
- `/groups` - List groups
- `/sources` - List catalogue sources
- `/tags` - List tags
- `/regions` - List geographic regions
- `/site` - Site configuration

## TypeScript Configuration

- Target: ES2022
- Module: Node16 (native ES modules)
- Output: dist/ directory
- Strict mode enabled
