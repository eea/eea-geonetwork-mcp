# List Geographic Regions

Get geographic regions/extents available in the catalogue.

## Usage

```
/regions [categoryId]
```

## Parameters

- `categoryId` (optional): Filter regions by category ID

## Examples

```
/regions
/regions countries
```

## Description

This command calls the `get_regions` MCP tool to retrieve all geographic regions and extents configured in the catalogue. Regions are used for spatial filtering and classification of metadata records.

---

Use the get_regions tool{{#if arg1}} with categoryId: "{{arg1}}"{{/if}}
