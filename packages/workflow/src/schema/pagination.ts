import { ss, type Schema } from "@temelj/standard-schema";

import type { CursorPayload } from "../types/pagination.ts";

const cursorKeyPartSchema = ss.union([ss.string(), ss.number(), ss.boolean(), ss.literal(null)]);

export const cursorPayloadSchema: Schema<unknown, CursorPayload> = ss.object({
  key: ss.refine(ss.array(cursorKeyPartSchema), (key) => key.length > 0, "Expected a cursor key"),
});
