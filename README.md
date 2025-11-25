# EEA SDI Catalogue MCP Server

A Model Context Protocol (MCP) server that provides tools to interact with the European Environment Agency (EEA) Spatial Data Infrastructure (SDI) Catalogue API, powered by GeoNetwork 4.4.9.

## Features

This MCP server provides 20 tools for interacting with the EEA SDI Catalogue:

### Search & Discovery
- **search_records** - Search for metadata records with full Elasticsearch query support
- **search_by_extent** - Find records by geographic bounding box
- **get_record** - Retrieve detailed metadata for a specific record by UUID
- **get_record_by_id** - Retrieve a record by its internal numeric ID
- **get_related_records** - Find related records (parent, children, services, datasets)

### Data Export & Management
- **get_record_formatters** - List available export formats for a record
- **export_record** - Export metadata in various formats (XML, PDF, etc.)
- **duplicate_record** - Duplicate an existing metadata record (requires authentication)

### Record Editing (Requires Authentication)
- **update_record** - Update any field using XPath (supports ISO 19139 and ISO 19115-3)
- **update_record_title** - Simplified tool to update a record's title (auto-detects schema)
- **add_record_tags** - Add tags/categories to a record
- **delete_record_tags** - Remove tags/categories from a record

### Resource/Attachment Management
- **upload_resource_from_url** - Upload a file from a URL to a metadata record (requires authentication)
- **get_attachments** - List all attachments/resources for a metadata record
- **delete_attachment** - Delete a specific attachment from a record (requires authentication)

### Catalogue Information
- **get_site_info** - Get catalogue configuration and site information
- **get_sources** - List catalogue sources and sub-portals
- **list_groups** - List all user groups
- **get_tags** - Get available tags/categories
- **get_regions** - Get geographic regions/extents

## Installation

1. Install dependencies:
```bash
npm install
```

2. Build the project:
```bash
npm run build
```

3. (Optional) Configure environment variables:
```bash
# Create a .env file in the project root
PORT=3001
BASE_URL=https://galliwasp.eea.europa.eu/catalogue/srv/api
MAX_SEARCH_RESULTS=20

# Authentication for write operations (duplicate, update)
CATALOGUE_USERNAME=your_username
CATALOGUE_PASSWORD='your_password'

# Rate limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

**Note:** For passwords containing special characters (`$`, `#`, etc.), wrap the value in single quotes.

## Usage

### Streamable HTTP Server (MCP Transport)

The server uses the official MCP Streamable HTTP transport with Server-Sent Events (SSE).

**Start the server:**
```bash
npm start
```

The server will start on port 3001 (or the port specified in the `PORT` environment variable).

**Available endpoints:**
- `GET http://localhost:3001/health` - Health check endpoint
- `GET http://localhost:3001/info` - Server information
- `POST http://localhost:3001/upload` - Upload file to basket (multipart/form-data)
- `GET http://localhost:3001/uploads/:filename` - Retrieve uploaded file
- `POST http://localhost:3001/` - MCP message endpoint (standard JSON-RPC)
- `GET http://localhost:3001/` - MCP SSE stream endpoint (for server-initiated messages)

**Testing the server:**
```bash
# Check if server is running
curl http://localhost:3001/health

# Should return: {"status":"ok","service":"eea-sdi-catalogue-mcp"}

# Upload a file to the basket
curl -X POST http://localhost:3001/upload -F "file=@myfile.pdf"

# Returns: {"success":true,"file":{"url":"http://localhost:3001/uploads/myfile-123456789.pdf",...}}
```

### Upload Basket

The server includes a built-in upload basket for temporary file storage. This allows LLMs to upload files first, then attach them to metadata records using the URL.

**How it works:**
1. Upload a file via `POST /upload` endpoint
2. Server stores the file in the `uploads/` directory
3. Server returns a URL: `http://localhost:3001/uploads/filename`
4. Use this URL with `upload_resource_from_url` tool to attach to metadata records

**Configuration:**
```bash
# Optional environment variables
UPLOAD_DIR=./uploads           # Upload directory (default: ./uploads)
MAX_FILE_SIZE=104857600        # Max file size in bytes (default: 100MB)
```

### With Claude Desktop

Add to your Claude Desktop configuration file:

**MacOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "eea-sdi-catalogue": {
      "command": "node",
      "args": ["C:\\Users\\dubos\\_Projects\\EEA_sdi_mcp\\dist\\index.js"]
    }
  }
}
```

## Example Queries

Once connected to Claude Desktop, you can ask questions like:

- "Search the EEA catalogue for datasets about air quality"
- "Find all metadata records within the bounding box of Europe"
- "Get detailed information about record UUID abc-123-def"
- "Export this metadata record as XML"
- "What geographic regions are available in the catalogue?"
- "Show me all datasets related to this parent record"

## API Base URL

The server connects to: `https://galliwasp.eea.europa.eu/catalogue/srv/api` (Sandbox Environment)

## Development

### Commands

- **Build**: `npm run build` - Compile TypeScript to dist/
- **Watch mode**: `npm run dev` - Compile TypeScript in watch mode (auto-recompile on changes)
- **Start**: `npm start` - Run the compiled server

### Development Workflow

For active development, run two commands in separate terminals:

**Terminal 1** - Compile TypeScript in watch mode:
```bash
npm run dev
```

**Terminal 2** - Start the server:
```bash
npm start
```

This way, TypeScript will automatically recompile when you make changes, and you can restart the server to pick up the new changes.

### Architecture

The server uses the official MCP SDK with Streamable HTTP transport (stateless mode):
- **Express server** handles HTTP endpoints with CORS support
- **MCP Server** handles tool requests via Streamable HTTP/SSE
- **Axios client** communicates with the EEA GeoNetwork API (30s timeout)
- **Modular design** with separate files:
  - `src/index.ts` - Server setup and routing
  - `src/tools.ts` - Tool definitions (20 tools)
  - `src/handlers.ts` - Tool implementation handlers
  - `src/types.ts` - TypeScript interfaces

## Tools Reference

### search_records
Search for metadata records in the catalogue.

**Parameters:**
- `query` (string): Search text
- `from` (number): Starting position (default: 0)
- `size` (number): Number of results (default: 10, max: 100)
- `bucket` (string): Filter by facet bucket
- `sortBy` (string): Sort field
- `sortOrder` (string): "asc" or "desc"

### get_record
Get detailed metadata for a specific record.

**Parameters:**
- `uuid` (string, required): Record UUID or ID
- `approved` (boolean): Only approved versions (default: true)

### search_by_extent
Search records by geographic extent.

**Parameters:**
- `minx` (number, required): Minimum longitude (west)
- `miny` (number, required): Minimum latitude (south)
- `maxx` (number, required): Maximum longitude (east)
- `maxy` (number, required): Maximum latitude (north)
- `relation` (string): Spatial relationship - "intersects", "within", or "contains" (default: "intersects")

### export_record
Export a metadata record in a specific format.

**Parameters:**
- `uuid` (string, required): Record UUID
- `formatter` (string, required): Format identifier (e.g., "xml", "pdf", "full_view")

Use `get_record_formatters` first to see available formats for a record.

### duplicate_record
Duplicate an existing metadata record with a new UUID. **Requires authentication.**

**Parameters:**
- `metadataUuid` (string, required): UUID of the record to duplicate
- `group` (string, optional): Target group for the duplicated record
- `isChildOfSource` (boolean, optional): Set the source record as parent of the new record (default: false)
- `targetUuid` (string, optional): Specific UUID to use for the duplicated record (auto-generated if not provided)
- `hasCategoryOfSource` (boolean, optional): Copy categories from source record (default: true)

### get_record_by_id
Retrieve a metadata record by its internal numeric ID. Useful for getting the UUID after a duplicate operation.

**Parameters:**
- `id` (number, required): Internal numeric ID of the record

### update_record
Update a metadata record field using XPath. **Requires authentication.**

**Parameters:**
- `uuid` (string, required): UUID of the record to update
- `xpath` (string, required): XPath to the element to update
- `value` (string, required): New value (text for simple replacement, or full XML element)
- `operation` (string, optional): Operation type - "replace" (default), "add", or "delete"
- `updateDateStamp` (boolean, optional): Update the record's timestamp (default: true)

**Common XPaths:**
- ISO 19139 title: `gmd:identificationInfo/*/gmd:citation/gmd:CI_Citation/gmd:title/gco:CharacterString`
- ISO 19115-3 title: `mdb:identificationInfo/*/mri:citation/cit:CI_Citation/cit:title/gco:CharacterString`

### update_record_title
Simplified tool to update a record's title. Automatically detects the schema (ISO 19139 or ISO 19115-3) and uses the correct XPath. **Requires authentication.**

**Parameters:**
- `uuid` (string, required): UUID of the record to update
- `title` (string, required): New title for the record

### add_record_tags
Add tags (categories) to a metadata record. **Requires authentication.**

**Parameters:**
- `uuid` (string, required): UUID of the record
- `tags` (array of numbers, required): Array of tag IDs to add

Use `get_tags` first to find available tag IDs.

### delete_record_tags
Remove tags (categories) from a metadata record. **Requires authentication.**

**Parameters:**
- `uuid` (string, required): UUID of the record
- `tags` (array of numbers, required): Array of tag IDs to remove

### upload_resource_from_url
Upload a resource (file/document) to a metadata record from a URL. The file will be downloaded from the URL and attached to the record. **Requires authentication.**

**Parameters:**
- `metadataUuid` (string, required): UUID of the metadata record to attach the resource to
- `url` (string, required): The URL of the file to download and attach
- `visibility` (string, optional): The sharing policy - "PUBLIC" or "PRIVATE" (default: PUBLIC)
- `approved` (boolean, optional): Use approved version or not (default: false)

**Example use case:**
- Attach a data file from an external server to a metadata record
- Link documentation PDFs to metadata records
- Attach images or visualizations stored on web servers

### get_attachments
List all attachments/resources for a metadata record.

**Parameters:**
- `metadataUuid` (string, required): UUID of the metadata record
- `sort` (string, optional): Sort results by "type" or "name" (default: name)
- `approved` (boolean, optional): Use approved version or not (default: true)
- `filter` (string, optional): Filter pattern for attachment names (default: *)

**Returns:** Array of attachment objects with details like filename, type, URL, size, etc.

### delete_attachment
Delete a specific attachment from a metadata record. **Requires authentication.**

**Parameters:**
- `metadataUuid` (string, required): UUID of the metadata record
- `resourceId` (string, required): The ID/filename of the resource to delete
- `approved` (boolean, optional): Use approved version or not (default: false)

**Note:** Use `get_attachments` first to find the exact resourceId of the attachment you want to delete.

## License

MIT

## Related Links

- [EEA SDI Sandbox Catalogue](https://galliwasp.eea.europa.eu/catalogue/)
- [API Documentation](https://galliwasp.eea.europa.eu/catalogue/doc/api/index.html)
- [GeoNetwork Documentation](https://geonetwork-opensource.org/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
