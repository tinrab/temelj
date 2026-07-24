import { z } from "zod";

export const stepIdSchema = z.string().refine((value) => value.trim().length > 0, "Expected an ID");

/** Non-empty identifier used for workflow steps. */
export type StepId = string;
