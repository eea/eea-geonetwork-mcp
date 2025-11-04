# Search by Geographic Extent

Search for records by geographic bounding box (spatial extent).

## Usage

```
/search-extent [minx] [miny] [maxx] [maxy] [relation]
```

## Parameters

- `minx` (required): Minimum longitude / West boundary
- `miny` (required): Minimum latitude / South boundary
- `maxx` (required): Maximum longitude / East boundary
- `maxy` (required): Maximum latitude / North boundary
- `relation` (optional): Spatial relationship - 'intersects', 'within', or 'contains' (default: intersects)

## Examples

```
/search-extent -10 35 30 70
/search-extent -10 35 30 70 within
/search-extent 5.5 47.0 15.5 55.0 contains
```

## Description

This command calls the `search_by_extent` MCP tool to find records whose geographic extent matches the specified bounding box according to the spatial relationship.

---

Use the search_by_extent tool with minx: {{arg1}}, miny: {{arg2}}, maxx: {{arg3}}, maxy: {{arg4}}{{#if arg5}}, relation: "{{arg5}}"{{/if}}
