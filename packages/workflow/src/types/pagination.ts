import { z } from "zod";

export const workflowCursorSchema = z.string({ error: "Workflow cursor is invalid" });
export const workflowPageDirectionSchema = z.literal("forward", {
  error: "Workflow page direction is invalid",
});
export const workflowCursorKeyPartSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const workflowCursorPayloadSchema = z.object({
  key: z.array(workflowCursorKeyPartSchema).nonempty(),
});

/** Type used for workflow cursor values. */
export type Cursor = string;

/** Type used for workflow page direction values. */
export type PageDirection = "forward";

/** Options for workflow page. */
export interface PageOptions {
  readonly cursor?: Cursor;
  readonly limit?: number;
  readonly direction?: PageDirection;
}

/** Type used for encoded workflow cursor payloads. */
export interface CursorPayload {
  readonly key: readonly CursorKeyPart[];
}

/** Type used for sortable workflow cursor key parts. */
export type CursorKeyPart = string | number | boolean | null;

/** Describes the workflow page contract. */
export interface WorkflowPage<TItem> {
  readonly items: readonly TItem[];
  readonly nextCursor?: Cursor;
  readonly hasMore: boolean;
}
