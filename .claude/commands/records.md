# Get Record by UUID

Retrieve detailed metadata for a specific record from the EEA SDI Catalogue.

## Usage

```
/records [uuid]
```

## Parameters

- `uuid` (required): The UUID or ID of the metadata record

## Example

```
/records e7967ccf-26f0-4758-8afc-5d1ff5b50577
```

## Description

This command calls the `get_record` MCP tool to fetch complete metadata information for a specific catalogue record, including title, abstract, keywords, contacts, and all ISO 19115-3 metadata elements.

---

Use the get_record tool with the UUID: {{arg1}}
