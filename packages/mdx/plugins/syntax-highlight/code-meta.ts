import { z } from "zod";
import { type NumericRange, parseNumericRange } from "@temelj/iterator";

import type { HastElement } from "../../types.ts";

export interface MdxCodeMeta {
  highlight?: MdxCodeMetaHighlightLine;
  showLineNumbers?: MdxCodeMetaLineNumbers;
  commandLine?: MdxCodeMetaCommandLine;
  fileName?: string;
}

export type MdxCodeMetaHighlightLine = {
  lineRange: NumericRange;
};

export type MdxCodeMetaLineNumbers = {
  lineRange: NumericRange;
};

export type MdxCodeMetaCommandLine = {
  commandRange: NumericRange;
};

export function extractCodeMeta(node: HastElement): MdxCodeMeta {
  const meta: string = node?.data?.meta ?? node?.properties?.metastring ?? "";
  return parseMetaString(meta);
}

const metaSchema = z.object({
  highlight: z.string().optional(),
  showLineNumbers: z.boolean().default(false),
  commandLine: z.string().optional(),
  fileName: z.string().optional(),
});

function parseMetaString(meta: string): MdxCodeMeta {
  let raw: unknown;
  try {
    raw = JSON.parse(meta.trim());
  } catch {
    return {};
  }
  const parsed = metaSchema.parse(raw);
  const options: MdxCodeMeta = {};

  if (parsed.highlight !== undefined) {
    options.highlight = { lineRange: parseNumericRange(parsed.highlight) };
  }

  if (parsed.showLineNumbers !== undefined) {
    if (typeof parsed.showLineNumbers === "string") {
      options.showLineNumbers = {
        lineRange: parseNumericRange(parsed.showLineNumbers),
      };
    } else if (parsed.showLineNumbers) {
      options.showLineNumbers = { lineRange: [] };
    }
  }

  if (parsed.commandLine !== undefined) {
    if (typeof parsed.commandLine === "string") {
      options.commandLine = {
        commandRange: parseNumericRange(parsed.commandLine),
      };
    } else if (parsed.commandLine) {
      options.commandLine = { commandRange: [] };
    }
  }

  if (typeof parsed.fileName === "string") {
    options.fileName = parsed.fileName.trim();
  }

  return options;
}
