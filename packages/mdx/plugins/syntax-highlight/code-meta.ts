import { type NumericRange, parseNumericRange } from "@temelj/iterator";
import * as v from "valibot";

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

const metaSchema = v.object({
  highlight: v.optional(v.string()),
  showLineNumbers: v.optional(v.union([v.boolean(), v.string()])),
  commandLine: v.optional(v.union([v.boolean(), v.string()])),
  fileName: v.optional(v.string()),
});

function parseMetaString(meta: string): MdxCodeMeta {
  let raw: unknown;
  try {
    raw = JSON.parse(meta.trim());
  } catch {
    return {};
  }
  const parsed = v.parse(metaSchema, raw);
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

  if (parsed.fileName !== undefined) {
    options.fileName = parsed.fileName.trim();
  }

  return options;
}
