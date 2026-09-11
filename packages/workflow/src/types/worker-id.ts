import { z } from "zod";

export const workerIdSchema = z
  .string({ error: "Expected an ID" })
  .refine((value) => value.trim().length > 0, "Expected an ID");

/** Non-empty identifier used when a worker claims and heartbeats workflow runs. */
export type WorkerId = z.infer<typeof workerIdSchema>;
