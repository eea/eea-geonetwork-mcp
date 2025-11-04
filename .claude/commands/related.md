# Get Related Records

Get records related to a specific record (parent, children, services, datasets, etc.).

## Usage

```
/related [uuid] [type]
```

## Parameters

- `uuid` (required): The UUID of the metadata record
- `type` (optional): Type of relationship to filter by

## Relationship Types

- `children` - Child records
- `parent` - Parent record
- `services` - Related services
- `datasets` - Related datasets
- `sources` - Source records
- `associated` - Associated records

## Examples

```
/related e7967ccf-26f0-4758-8afc-5d1ff5b50577
/related e7967ccf-26f0-4758-8afc-5d1ff5b50577 children
/related abc-123-def services
```

## Description

This command calls the `get_related_records` MCP tool to discover relationships between metadata records. Without a type parameter, it returns all related records.

---

Use the get_related_records tool with uuid: "{{arg1}}"{{#if arg2}}, type: "{{arg2}}"{{/if}}
