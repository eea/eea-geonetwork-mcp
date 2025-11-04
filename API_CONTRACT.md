# MCP HTTP API Contract

This document defines the API contract between the MCP server and its clients (e.g., the EEA Chatbot).

**Version:** 1.0.0
**Last Updated:** 2025-10-28

## Important for Developers

⚠️ **When you change this API, you MUST:**
1. Update the version number above
2. Update this contract document
3. Update client code (e.g., `mcpService.ts` in EEA_CHATBOT)
4. Test the integration end-to-end
5. Notify other developers using this API

---

## Base URL

- **Development:** `http://localhost:3001`
- **Production:** TBD

---

## Endpoints

### 1. Health Check

**GET** `/health`

**Description:** Check if the server is running

**Response:**
```json
{
  "status": "ok",
  "service": "eea-sdi-catalogue-api"
}
```

---

### 2. List Available Tools

**GET** `/tools`

**Description:** Get list of all available API endpoints with descriptions

**Response:**
```json
{
  "tools": [
    {
      "name": "search_records",
      "method": "POST",
      "path": "/api/search",
      "description": "...",
      "parameters": { ... }
    },
    ...
  ]
}
```

---

### 3. Search Records ⭐

**POST** `/api/search`

**Description:** Search for metadata records in the EEA SDI Catalogue

**Request Body:**
```typescript
{
  query?: string;      // Search query text
  from?: number;       // Starting position (default: 0)
  size?: number;       // Number of results (default: 10, max: 100)
  bucket?: string;     // Filter by facet bucket
  sortBy?: string;     // Field to sort by
  sortOrder?: string;  // "asc" or "desc"
}
```

**Example Request:**
```json
{
  "query": "water quality",
  "size": 5,
  "from": 0
}
```

**Response:**
```json
{
  "took": 2,
  "hits": {
    "total": { "value": 1309 },
    "hits": [
      {
        "_id": "uuid",
        "_source": {
          "resourceTitleObject": { "default": "Title" },
          "resourceAbstractObject": { "default": "Description" },
          "uuid": "record-uuid",
          ...
        }
      },
      ...
    ]
  }
}
```

**Client Implementation:**
```typescript
// In mcpService.ts
async searchRecords(params: SearchParams = {}) {
  const response = await fetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return await response.json();
}
```

---

### 4. Get Record Details

**GET** `/api/records/:uuid`

**Description:** Get detailed metadata for a specific record

**URL Parameters:**
- `uuid` (required) - The UUID of the record

**Query Parameters:**
- `approved` (optional, default: true) - Only return approved versions

**Example Request:**
```
GET /api/records/3ccf2fe3-40e3-4968-a54c-5a59510fa5a3?approved=true
```

**Response:**
```json
{
  "resourceTitleObject": { "default": "Title" },
  "resourceAbstractObject": { "default": "Description" },
  "uuid": "...",
  "publicationDateForResource": ["2025-10-01"],
  ...
}
```

---

### 5. Get Record Formatters

**GET** `/api/records/:uuid/formatters`

**Description:** Get available export formats for a record

**URL Parameters:**
- `uuid` (required) - The UUID of the record

**Response:**
```json
[
  { "name": "xml", "label": "ISO19139 XML" },
  { "name": "pdf", "label": "PDF" },
  ...
]
```

---

### 6. Export Record

**GET** `/api/records/:uuid/export/:formatter`

**Description:** Export a metadata record in a specific format

**URL Parameters:**
- `uuid` (required) - The UUID of the record
- `formatter` (required) - The formatter to use (e.g., "xml", "pdf")

**Response:** Raw format data (XML, PDF, etc.)

---

### 7. Get Related Records

**GET** `/api/records/:uuid/related`

**Description:** Get records related to a specific record

**URL Parameters:**
- `uuid` (required) - The UUID of the record

**Query Parameters:**
- `type` (optional) - Type of relationship ("children", "parent", "services", "datasets", etc.)

**Response:**
```json
[
  {
    "uuid": "related-uuid",
    "title": "Related Record Title",
    ...
  },
  ...
]
```

---

### 8. List Groups

**GET** `/api/groups`

**Description:** List all groups in the catalogue

**Query Parameters:**
- `withReservedGroup` (optional, default: false) - Include reserved system groups

**Response:**
```json
[
  {
    "id": 1,
    "name": "Group Name",
    ...
  },
  ...
]
```

---

### 9. Get Sources

**GET** `/api/sources`

**Description:** Get information about catalogue sources (sub-portals)

**Response:**
```json
[
  {
    "uuid": "source-uuid",
    "name": "Source Name",
    ...
  },
  ...
]
```

---

### 10. Get Site Info

**GET** `/api/site`

**Description:** Get general information about the catalogue site configuration

**Response:**
```json
{
  "name": "EEA SDI Catalogue",
  "version": "4.4.9",
  ...
}
```

---

### 11. Get Tags

**GET** `/api/tags`

**Description:** Get all available tags/categories in the catalogue

**Response:**
```json
[
  {
    "id": 1069956,
    "name": "water",
    "label": { "eng": "water" }
  },
  {
    "id": 1069961,
    "name": "biodiversity",
    "label": { "eng": "biodiversity" }
  },
  ...
]
```

---

### 12. Get Regions

**GET** `/api/regions`

**Description:** Get geographic regions/extents available in the catalogue

**Query Parameters:**
- `categoryId` (optional) - Filter regions by category ID

**Response:**
```json
[
  {
    "id": "region-id",
    "name": "Region Name",
    ...
  },
  ...
]
```

---

### 13. Search by Geographic Extent

**POST** `/api/search/extent`

**Description:** Search for records by geographic bounding box

**Request Body:**
```typescript
{
  minx: number;      // Minimum longitude (west) - REQUIRED
  miny: number;      // Minimum latitude (south) - REQUIRED
  maxx: number;      // Maximum longitude (east) - REQUIRED
  maxy: number;      // Maximum latitude (north) - REQUIRED
  relation?: string; // "intersects", "within", "contains" (default: "intersects")
}
```

**Example Request:**
```json
{
  "minx": -10,
  "miny": 35,
  "maxx": 40,
  "maxy": 70,
  "relation": "intersects"
}
```

**Response:** Same format as `/api/search`

---

## Error Handling

All endpoints return errors in this format:

**Status Codes:**
- `200` - Success
- `400` - Bad request (invalid parameters)
- `404` - Not found (record doesn't exist)
- `500` - Internal server error

**Error Response:**
```json
{
  "error": "Error message",
  "details": { ... }
}
```

---

## CORS

CORS is enabled for all origins in development. Update for production.

---

## Versioning Strategy

**Current Version:** 1.0.0

**Semantic Versioning:**
- **Major (X.0.0)** - Breaking changes (requires client updates)
  - Example: Changing request/response format
  - Example: Removing endpoints

- **Minor (1.X.0)** - New features (backward compatible)
  - Example: Adding new optional parameters
  - Example: Adding new endpoints

- **Patch (1.0.X)** - Bug fixes (backward compatible)
  - Example: Fixing response data
  - Example: Performance improvements

---

## Client Compatibility

**Clients using this API:**
1. **EEA_CHATBOT** - React chatbot (uses `mcpService.ts`)
   - Location: `c:\Users\dubos\_Projects\EEA_CHATBOT\src\services\mcpService.ts`
   - Contact: [Your team]

---

## Change Log

### Version 1.0.0 (2025-10-28)
- Initial API contract
- Implemented all 13 endpoints
- Fixed search endpoint to use Elasticsearch POST format

### Future Versions
- TBD

---

## Testing the API

### Using curl:

```bash
# Health check
curl http://localhost:3001/health

# Get tags
curl http://localhost:3001/api/tags

# Search
curl -X POST http://localhost:3001/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "water", "size": 5}'
```

### Using the chatbot:
```
/search water quality
/tags
/regions
```

---

## Notes for Maintainers

1. **Before changing the API:**
   - Check if it's a breaking change
   - Update this document first
   - Update version number
   - Test with all clients

2. **When adding new endpoints:**
   - Add to this document
   - Update `/tools` endpoint response
   - Add corresponding method to `mcpService.ts`
   - Update user documentation

3. **Internal changes (no API impact):**
   - Like the recent Elasticsearch query fix
   - Don't require client updates
   - Still document in change log

4. **Testing:**
   - Always test with actual client (chatbot)
   - Don't assume it works if only curl works
   - Test error cases too
