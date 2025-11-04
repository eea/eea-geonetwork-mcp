# EEA SDI Catalogue MCP Server

A Model Context Protocol (MCP) server that provides tools to interact with the European Environment Agency (EEA) Spatial Data Infrastructure (SDI) Catalogue API, powered by GeoNetwork 4.4.9.

## Features

This MCP server provides 11 tools for interacting with the EEA SDI Catalogue:

### Search & Discovery
- **search_records** - Search for metadata records with full Elasticsearch query support
- **search_by_extent** - Find records by geographic bounding box
- **get_record** - Retrieve detailed metadata for a specific record
- **get_related_records** - Find related records (parent, children, services, datasets)

### Data Export
- **get_record_formatters** - List available export formats for a record
- **export_record** - Export metadata in various formats (XML, PDF, etc.)

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

## Usage

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

### Standalone Usage

```bash
npm start
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

- **Build**: `npm run build`
- **Watch mode**: `npm run dev`
- **Start**: `npm start`

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

## License

MIT

## Related Links

- [EEA SDI Sandbox Catalogue](https://galliwasp.eea.europa.eu/catalogue/)
- [API Documentation](https://galliwasp.eea.europa.eu/catalogue/doc/api/index.html)
- [GeoNetwork Documentation](https://geonetwork-opensource.org/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
