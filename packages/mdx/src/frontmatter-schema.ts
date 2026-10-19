import type { SchemaIssue, SchemaResult } from "@temelj/standard-schema";

import { isObject } from "@temelj/value";

import type { SourceRange } from "./ranges.ts";
import type { SourceFile } from "./source.ts";

import { createDiagnostic } from "./diagnostics.ts";
import { FrontmatterError } from "./errors.ts";

/** Converts Standard Schema failures to the shared frontmatter diagnostics. */
export function frontmatterSchemaValue<T>(
  result: SchemaResult<T>,
  file: SourceFile,
  origin: SourceRange | undefined,
): T {
  if (result.issues !== undefined) {
    const diagnostics = result.issues.map((issue) =>
      createDiagnostic({
        severity: "error",
        code: "mdx.frontmatter.schema",
        message: formatSchemaIssue(issue),
        span: origin === undefined ? undefined : { file, ...origin },
      }),
    );

    throw FrontmatterError.schemaValidationFailed(file, diagnostics, result.issues);
  }

  return result.value;
}

function formatSchemaIssue(issue: SchemaIssue): string {
  const path = issue.path?.map((part) => String(isObject(part) ? part.key : part)).join(".");

  return path === undefined || path.length === 0 ? issue.message : `${path}: ${issue.message}`;
}
