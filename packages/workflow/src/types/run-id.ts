import { z } from "zod";

export const runIdSchema = z.string().refine((value) => value.trim().length > 0, "Expected an ID");

/** Non-empty identifier used for workflow runs. */
export type RunId = string;
