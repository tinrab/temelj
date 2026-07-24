import { z } from "zod";

export const messageIdSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "Expected an ID");

/** Non-empty identifier used to route durable workflow messages. */
export type MessageId = string;
