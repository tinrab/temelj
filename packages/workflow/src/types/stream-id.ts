import { z } from "zod";

export const streamIdSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "Expected an ID");

export type StreamId = string;

export type StreamIdOrName = string;
