export interface ToolResponse {
  content: Array<{
    type: "text";
    text: string;
  }>;
  isError?: boolean;
}

export interface SearchRecordsArgs {
  query?: string;
  from?: number;
  size?: number;
  bucket?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface GetRecordArgs {
  uuid: string;
  approved?: boolean;
}

export interface GetRecordFormattersArgs {
  uuid: string;
}

export interface ExportRecordArgs {
  uuid: string;
  formatter: string;
}

export interface ListGroupsArgs {
  withReservedGroup?: boolean;
}

export interface GetRelatedRecordsArgs {
  uuid: string;
  type?: string;
}

export interface GetRegionsArgs {
  categoryId?: string;
}

export interface SearchByExtentArgs {
  minx: number;
  miny: number;
  maxx: number;
  maxy: number;
  relation?: "intersects" | "within" | "contains";
}

export interface DuplicateRecordArgs {
  metadataUuid: string;
  group?: string;
  isChildOfSource?: boolean;
  targetUuid?: string;
  hasCategoryOfSource?: boolean;
}

export interface HandlerConfig {
  maxSearchResults: number;
  username: string;
  password: string;
}
