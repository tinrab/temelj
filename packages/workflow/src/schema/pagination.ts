import { ss } from "@temelj/standard-schema";

const cursorKeyPartSchema = ss.union([ss.string(), ss.number(), ss.boolean(), ss.literal(null)]);

export const cursorPayloadSchema = ss.object({
  key: ss.refine(ss.array(cursorKeyPartSchema), (key) => key.length > 0, "Expected a cursor key"),
});
