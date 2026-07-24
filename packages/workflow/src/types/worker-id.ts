import { z } from "zod";

export const workerIdSchema = z
  .custom<WorkerId>()
  .refine((value) => typeof value === "string" && value.trim().length > 0, "Expected an ID");

/** Non-empty identifier used when a worker claims and heartbeats workflow runs. */
export type WorkerId = string;
