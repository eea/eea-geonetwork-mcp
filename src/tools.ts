import { Tool } from "@modelcontextprotocol/sdk/types.js";

export const tools: Tool[] = [
  {
    name: "search_records",
    description: "Search for metadata records in the EEA catalogue. Supports full Elasticsearch query syntax.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query text (searches across all fields)",
        },
        from: {
          type: "number",
          description: "Starting position for results (default: 0)",
          default: 0,
        },
        size: {
          type: "number",
          description: "Number of results to return (default: 10, max: 100)",
          default: 10,
        },
        bucket: {
          type: "string",
          description: "Filter by specific facet bucket",
        },
        sortBy: {
          type: "string",
          description: "Field to sort by (e.g., 'resourceTitleObject.default.sort')",
        },
        sortOrder: {
          type: "string",
          enum: ["asc", "desc"],
          description: "Sort order (ascending or descending)",
        },
      },
    },
  },
  {
    name: "get_record",
    description: "Get detailed metadata for a specific record by its UUID or ID",
    inputSchema: {
      type: "object",
      properties: {
        uuid: {
          type: "string",
          description: "The UUID or ID of the metadata record",
        },
        approved: {
          type: "boolean",
          description: "Only return approved versions (default: true)",
          default: true,
        },
      },
      required: ["uuid"],
    },
  },
  {
    name: "get_record_formatters",
    description: "Get available formatters (export formats) for a metadata record",
    inputSchema: {
      type: "object",
      properties: {
        uuid: {
          type: "string",
          description: "The UUID of the metadata record",
        },
      },
      required: ["uuid"],
    },
  },
  {
    name: "export_record",
    description: "Export a metadata record in a specific format (XML, PDF, etc.)",
    inputSchema: {
      type: "object",
      properties: {
        uuid: {
          type: "string",
          description: "The UUID of the metadata record",
        },
        formatter: {
          type: "string",
          description: "The formatter/format to use (e.g., 'xml', 'pdf', 'full_view')",
        },
      },
      required: ["uuid", "formatter"],
    },
  },
  {
    name: "list_groups",
    description: "List all groups in the catalogue",
    inputSchema: {
      type: "object",
      properties: {
        withReservedGroup: {
          type: "boolean",
          description: "Include reserved system groups",
          default: false,
        },
      },
    },
  },
  {
    name: "get_sources",
    description: "Get information about catalogue sources (sub-portals)",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_site_info",
    description: "Get general information about the catalogue site configuration",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_related_records",
    description: "Get records related to a specific record (parent, children, services, datasets, etc.)",
    inputSchema: {
      type: "object",
      properties: {
        uuid: {
          type: "string",
          description: "The UUID of the metadata record",
        },
        type: {
          type: "string",
          description: "Type of relationship (e.g., 'children', 'parent', 'services', 'datasets', 'sources', 'associated')",
        },
      },
      required: ["uuid"],
    },
  },
  {
    name: "get_tags",
    description: "Get all available tags/categories in the catalogue",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_regions",
    description: "Get geographic regions/extents available in the catalogue",
    inputSchema: {
      type: "object",
      properties: {
        categoryId: {
          type: "string",
          description: "Filter regions by category ID",
        },
      },
    },
  },
  {
    name: "search_by_extent",
    description: "Search for records by geographic extent (bounding box)",
    inputSchema: {
      type: "object",
      properties: {
        minx: {
          type: "number",
          description: "Minimum longitude (west)",
        },
        miny: {
          type: "number",
          description: "Minimum latitude (south)",
        },
        maxx: {
          type: "number",
          description: "Maximum longitude (east)",
        },
        maxy: {
          type: "number",
          description: "Maximum latitude (north)",
        },
        relation: {
          type: "string",
          enum: ["intersects", "within", "contains"],
          description: "Spatial relationship (default: intersects)",
          default: "intersects",
        },
      },
      required: ["minx", "miny", "maxx", "maxy"],
    },
  },
  {
    name: "duplicate_record",
    description: "Duplicate a metadata record. Creates a copy of an existing record with a new UUID.",
    inputSchema: {
      type: "object",
      properties: {
        metadataUuid: {
          type: "string",
          description: "The UUID of the metadata record to duplicate",
        },
        group: {
          type: "string",
          description: "Target group for the duplicated record (optional)",
        },
        isChildOfSource: {
          type: "boolean",
          description: "Set the source record as parent of the new record (default: false)",
          default: false,
        },
        targetUuid: {
          type: "string",
          description: "Specific UUID to use for the duplicated record (optional, will be auto-generated if not provided)",
        },
        hasCategoryOfSource: {
          type: "boolean",
          description: "Copy categories from source record (default: true)",
          default: true,
        },
      },
      required: ["metadataUuid"],
    },
  },
  {
    name: "update_record",
    description: "Update a metadata record field using XPath. Supports replacing, adding, or deleting XML elements. Requires authentication.",
    inputSchema: {
      type: "object",
      properties: {
        uuid: {
          type: "string",
          description: "The UUID of the metadata record to update",
        },
        xpath: {
          type: "string",
          description: "XPath to the element to update. Common paths: 'gmd:identificationInfo/*/gmd:citation/gmd:CI_Citation/gmd:title/gco:CharacterString' for title, 'gmd:identificationInfo/*/gmd:abstract/gco:CharacterString' for abstract",
        },
        value: {
          type: "string",
          description: "The new value. For simple text replacement, just provide the text (e.g., 'New Title'). For XML replacement, provide the full XML element.",
        },
        operation: {
          type: "string",
          enum: ["replace", "add", "delete"],
          description: "Operation type: 'replace' (default), 'add' new element, or 'delete' element",
          default: "replace",
        },
        updateDateStamp: {
          type: "boolean",
          description: "Update the record's date stamp (default: true)",
          default: true,
        },
      },
      required: ["uuid", "xpath", "value"],
    },
  },
  {
    name: "get_record_by_id",
    description: "Get a metadata record by its internal numeric ID. Useful for retrieving the UUID after a duplicate operation returns an ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "number",
          description: "The internal numeric ID of the metadata record",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "update_record_title",
    description: "Update the title of a metadata record. Automatically detects the schema (ISO 19139 or ISO 19115-3) and uses the correct XPath.",
    inputSchema: {
      type: "object",
      properties: {
        uuid: {
          type: "string",
          description: "The UUID of the metadata record to update",
        },
        title: {
          type: "string",
          description: "The new title for the record",
        },
      },
      required: ["uuid", "title"],
    },
  },
  {
    name: "add_record_tags",
    description: "Add tags (categories) to a metadata record. Use get_tags first to find available tag IDs. Requires authentication.",
    inputSchema: {
      type: "object",
      properties: {
        uuid: {
          type: "string",
          description: "The UUID of the metadata record",
        },
        tags: {
          type: "array",
          items: { type: "number" },
          description: "Array of tag IDs to add to the record",
        },
      },
      required: ["uuid", "tags"],
    },
  },
  {
    name: "delete_record_tags",
    description: "Remove tags (categories) from a metadata record. Requires authentication.",
    inputSchema: {
      type: "object",
      properties: {
        uuid: {
          type: "string",
          description: "The UUID of the metadata record",
        },
        tags: {
          type: "array",
          items: { type: "number" },
          description: "Array of tag IDs to remove from the record",
        },
      },
      required: ["uuid", "tags"],
    },
  },
];
