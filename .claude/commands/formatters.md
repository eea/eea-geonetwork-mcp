# List Export Formatters

Get available formatters (export formats) for a metadata record.

## Usage

```
/formatters [uuid]
```

## Parameters

- `uuid` (required): The UUID of the metadata record

## Example

```
/formatters e7967ccf-26f0-4758-8afc-5d1ff5b50577
```

## Description

This command calls the `get_record_formatters` MCP tool to list all available export formats for a specific record. Common formats include XML, PDF, HTML views, and various metadata standards (ISO 19139, Dublin Core, etc.).

Use this before calling `/export` to see what format options are available.

---

Use the get_record_formatters tool with uuid: "{{arg1}}"
