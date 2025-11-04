# EEA SDI Catalogue HTTP API Server

This is an HTTP REST API version of the MCP server that provides access to the EEA SDI Catalogue API (GeoNetwork 4.4.9).

## Getting Started

### Installation

```bash
npm install
```

### Running the Server

```bash
# Build and start the HTTP server
npm run dev:http

# Or build first, then start
npm run build
npm run start:http
```

The server will start on `http://localhost:3001` by default.

You can change the port by setting the `PORT` environment variable:
```bash
PORT=8080 npm run start:http
```

## API Endpoints

### Health Check
```bash
GET /health
```
Returns server status.

**Example:**
```bash
curl http://localhost:3001/health
```

### List All Tools
```bash
GET /tools
```
Returns a list of all available API endpoints with their descriptions and parameters.

**Example:**
```bash
curl http://localhost:3001/tools
```

### Search Records
```bash
POST /api/search
```
Search for metadata records in the EEA catalogue.

**Body Parameters:**
- `query` (string) - Search query text
- `from` (number) - Starting position for results (default: 0)
- `size` (number) - Number of results (default: 10, max: 100)
- `bucket` (string) - Filter by specific facet bucket
- `sortBy` (string) - Field to sort by
- `sortOrder` (string) - Sort order ('asc' or 'desc')

**Example:**
```bash
curl -X POST http://localhost:3001/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "water quality", "size": 5}'
```

### Get Record Details
```bash
GET /api/records/:uuid
```
Get detailed metadata for a specific record.

**URL Parameters:**
- `uuid` (required) - The UUID of the record

**Query Parameters:**
- `approved` (boolean) - Only return approved versions (default: true)

**Example:**
```bash
curl http://localhost:3001/api/records/12345678-1234-1234-1234-123456789abc
```

### Get Record Formatters
```bash
GET /api/records/:uuid/formatters
```
Get available export formats for a record.

**Example:**
```bash
curl http://localhost:3001/api/records/12345678-1234-1234-1234-123456789abc/formatters
```

### Export Record
```bash
GET /api/records/:uuid/export/:formatter
```
Export a record in a specific format (XML, PDF, etc.).

**URL Parameters:**
- `uuid` (required) - The UUID of the record
- `formatter` (required) - The formatter/format to use (e.g., 'xml', 'pdf')

**Example:**
```bash
curl http://localhost:3001/api/records/12345678-1234-1234-1234-123456789abc/export/xml
```

### Get Related Records
```bash
GET /api/records/:uuid/related
```
Get records related to a specific record.

**URL Parameters:**
- `uuid` (required) - The UUID of the record

**Query Parameters:**
- `type` (string) - Type of relationship (e.g., 'children', 'parent', 'services', 'datasets')

**Example:**
```bash
curl http://localhost:3001/api/records/12345678-1234-1234-1234-123456789abc/related?type=children
```

### List Groups
```bash
GET /api/groups
```
List all groups in the catalogue.

**Query Parameters:**
- `withReservedGroup` (boolean) - Include reserved system groups (default: false)

**Example:**
```bash
curl http://localhost:3001/api/groups?withReservedGroup=false
```

### Get Sources
```bash
GET /api/sources
```
Get information about catalogue sources (sub-portals).

**Example:**
```bash
curl http://localhost:3001/api/sources
```

### Get Site Info
```bash
GET /api/site
```
Get general information about the catalogue site configuration.

**Example:**
```bash
curl http://localhost:3001/api/site
```

### Get Tags
```bash
GET /api/tags
```
Get all available tags/categories in the catalogue.

**Example:**
```bash
curl http://localhost:3001/api/tags
```

### Get Regions
```bash
GET /api/regions
```
Get geographic regions/extents available in the catalogue.

**Query Parameters:**
- `categoryId` (string) - Filter regions by category ID

**Example:**
```bash
curl http://localhost:3001/api/regions
```

### Search by Geographic Extent
```bash
POST /api/search/extent
```
Search for records by geographic bounding box.

**Body Parameters:**
- `minx` (number, required) - Minimum longitude (west)
- `miny` (number, required) - Minimum latitude (south)
- `maxx` (number, required) - Maximum longitude (east)
- `maxy` (number, required) - Maximum latitude (north)
- `relation` (string) - Spatial relationship ('intersects', 'within', 'contains', default: 'intersects')

**Example:**
```bash
curl -X POST http://localhost:3001/api/search/extent \
  -H "Content-Type: application/json" \
  -d '{
    "minx": -10,
    "miny": 35,
    "maxx": 40,
    "maxy": 70,
    "relation": "intersects"
  }'
```

## Error Handling

All endpoints return JSON responses. Errors are returned with appropriate HTTP status codes and include an error message:

```json
{
  "error": "Error message",
  "details": { ... }
}
```

## CORS

CORS is enabled for all origins by default, making it suitable for use with web applications.

## Integration with React Chatbot

To use this API from your React chatbot, you can make HTTP requests using `fetch` or `axios`:

```typescript
// Example: Search for records
const searchRecords = async (query: string) => {
  const response = await fetch('http://localhost:3001/api/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, size: 10 }),
  });
  return await response.json();
};

// Example: Get tags
const getTags = async () => {
  const response = await fetch('http://localhost:3001/api/tags');
  return await response.json();
};
```

## Differences from MCP Version

The HTTP version has the following differences from the stdio MCP version:

1. **Transport**: Uses HTTP REST instead of stdio
2. **Response Format**: Returns JSON directly instead of MCP protocol format
3. **Error Handling**: Uses HTTP status codes instead of MCP error format
4. **CORS Enabled**: Allows cross-origin requests from browsers
5. **Direct Access**: Can be called from any HTTP client (browsers, curl, Postman, etc.)

## Notes

- The original MCP version (stdio) is still available via `npm start`
- This HTTP version runs on port 3001 by default
- Both versions connect to the same EEA SDI Catalogue API backend
