import type { StandardSchemaV1 } from "@standard-schema/spec";

import { type NumericRange, parseNumericRange } from "@temelj/iterator";

import type { HastElement } from "../../types";

import { validateStandardSchemaSync } from "../../standard-schema";

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

interface RawMdxCodeMeta {
  highlight?: string | undefined;
  showLineNumbers?: boolean | string | undefined;
  commandLine?: boolean | string | undefined;
  fileName?: string | undefined;
}

const metaSchema: StandardSchemaV1<unknown, RawMdxCodeMeta> = {
  "~standard": {
    version: 1,
    vendor: "@temelj/mdx",
    validate(value) {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return { issues: [{ message: "Expected object" }] };
      }

      const raw = value as Record<string, unknown>;
      const issues: StandardSchemaV1.Issue[] = [];
      validateOptionalString(raw.highlight, "highlight", issues);
      validateOptionalStringOrBoolean(raw.showLineNumbers, "showLineNumbers", issues);
      validateOptionalStringOrBoolean(raw.commandLine, "commandLine", issues);
      validateOptionalString(raw.fileName, "fileName", issues);
      if (issues.length > 0) {
        return { issues };
      }

      return {
        value: {
          highlight: raw.highlight as string | undefined,
          showLineNumbers: raw.showLineNumbers as boolean | string | undefined,
          commandLine: raw.commandLine as boolean | string | undefined,
          fileName: raw.fileName as string | undefined,
        },
      };
    },
  },
};

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

function validateOptionalString(
  value: unknown,
  key: string,
  issues: StandardSchemaV1.Issue[],
): void {
  if (value !== undefined && typeof value !== "string") {
    issues.push({ message: "Expected string", path: [key] });
  }
}

function validateOptionalStringOrBoolean(
  value: unknown,
  key: string,
  issues: StandardSchemaV1.Issue[],
): void {
  if (value !== undefined && typeof value !== "string" && typeof value !== "boolean") {
    issues.push({ message: "Expected string or boolean", path: [key] });
  }
}
