import { type NumericRange, parseNumericRange } from "@temelj/iterator";
import { ss, validateStandardSchemaSync } from "@temelj/standard-schema";

import type { HastElement } from "../../types";

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
  const meta = node?.data?.meta ?? node?.properties?.metastring ?? "";
  return parseMetaString(meta as string);
}

const stringOrBoolean = ss.union(
  [ss.string("Expected string or boolean"), ss.boolean("Expected string or boolean")],
  "Expected string or boolean",
);

const metaSchema = ss.object(
  {
    highlight: ss.optional(ss.string("Expected string")),
    showLineNumbers: ss.optional(stringOrBoolean),
    commandLine: ss.optional(stringOrBoolean),
    fileName: ss.optional(ss.string("Expected string")),
  },
  "Expected object",
);

function parseMetaString(meta: string): MdxCodeMeta {
  let raw: unknown;
  try {
    raw = JSON.parse(meta.trim());
  } catch {
    return {};
  }
  const parsed = validateStandardSchemaSync(metaSchema, raw, "Code metadata validation failed");
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
