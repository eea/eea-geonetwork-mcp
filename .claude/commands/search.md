# Search Records

Search for metadata records in the EEA SDI Catalogue with full Elasticsearch query support.

## Usage

```
/search [query] [from] [size] [sortBy] [sortOrder]
```

## Parameters

- `query` (optional): Search query text (searches across all fields)
- `from` (optional): Starting position for results (default: 0)
- `size` (optional): Number of results to return (default: 10, max: 100)
- `sortBy` (optional): Field to sort by (e.g., 'resourceTitleObject.default.sort')
- `sortOrder` (optional): Sort order - 'asc' or 'desc'

## Examples

```
/search climate change
/search air quality 0 20
/search water pollution 0 10 resourceTitleObject.default.sort asc
```

## Description

This command calls the `search_records` MCP tool to search the catalogue using Elasticsearch query syntax. Returns matching records with metadata including titles, abstracts, and identifiers.

---

Use the search_records tool with query: "{{arg1}}", from: {{arg2 or 0}}, size: {{arg3 or 10}}{{#if arg4}}, sortBy: "{{arg4}}"{{/if}}{{#if arg5}}, sortOrder: "{{arg5}}"{{/if}}
