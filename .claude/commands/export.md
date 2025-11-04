# Export Record

Export a metadata record in a specific format (XML, PDF, etc.).

## Usage

```
/export [uuid] [format]
```

## Parameters

- `uuid` (required): The UUID of the metadata record to export
- `format` (required): The formatter/format to use (e.g., 'xml', 'pdf', 'full_view')

## Examples

```
/export e7967ccf-26f0-4758-8afc-5d1ff5b50577 xml
/export abc-123-def pdf
/export abc-123-def full_view
```

## Description

This command calls the `export_record` MCP tool to export metadata in various formats. Use the `/formatters` command first to see available formats for a specific record.

## Tip

To see available formats for a record, first run:
```
/formatters [uuid]
```

---

Use the export_record tool with uuid: "{{arg1}}", formatter: "{{arg2}}"
