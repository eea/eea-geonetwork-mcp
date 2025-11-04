# List Groups

List all groups in the catalogue.

## Usage

```
/groups [withReservedGroup]
```

## Parameters

- `withReservedGroup` (optional): Include reserved system groups (true/false, default: false)

## Examples

```
/groups
/groups true
```

## Description

This command calls the `list_groups` MCP tool to retrieve all user groups configured in the catalogue. Groups are used for access control and record ownership.

---

Use the list_groups tool{{#if arg1}} with withReservedGroup: {{arg1}}{{/if}}
