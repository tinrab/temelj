export type Cursor = string;

export interface PageOptions {
  readonly cursor?: Cursor;
  readonly limit?: number;
}

export interface CursorPayload {
  readonly key: readonly CursorKeyPart[];
}

export type CursorKeyPart = string | number | boolean | null;

export interface WorkflowPage<TItem> {
  readonly items: readonly TItem[];
  readonly nextCursor?: Cursor;
  readonly hasMore: boolean;
}
