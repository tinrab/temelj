import { isString, isNumber, isPlainObject } from "@temelj/value";

export interface CodeLineRange {
  readonly end: number;
  readonly start: number;
}

export type CodeLineSelection =
  | { readonly kind: "all" }
  | { readonly kind: "ranges"; readonly ranges: readonly CodeLineRange[] };

export interface CodeLineNumbers {
  readonly lines: CodeLineSelection;
  readonly start: number;
}

export interface CodeBlockMetadata {
  readonly commandLines?: CodeLineSelection;
  readonly fileName?: string;
  readonly highlightedLines?: CodeLineSelection;
  readonly lineNumbers?: CodeLineNumbers;
  readonly raw?: string;
}

type MutableCodeBlockMetadata = { -readonly [K in keyof CodeBlockMetadata]: CodeBlockMetadata[K] };

export interface CodeBlockMetadataIssue {
  readonly field?: "commandLines" | "fileName" | "highlightLines" | "lineNumbers";
  readonly message: string;
}

export type CodeBlockMetadataParseResult =
  | { readonly kind: "parsed"; readonly metadata: CodeBlockMetadata }
  | {
      readonly kind: "invalid";
      readonly issues: readonly CodeBlockMetadataIssue[];
      readonly metadata: CodeBlockMetadata;
    };

const allLines: CodeLineSelection = { kind: "all" };

const selectorPattern = /^\s*\d+(?:\s*-\s*\d+)?(?:\s*,\s*\d+(?:\s*-\s*\d+)?)*\s*$/u;

/** Parses JSON metadata for fenced code blocks without changing the authored value. */
export function parseCodeBlockMetadata(raw?: string): CodeBlockMetadataParseResult {
  if (raw === undefined || raw.trim().length === 0) {
    return { kind: "parsed", metadata: { raw } };
  }

  let input: unknown;

  try {
    input = JSON.parse(raw);
  } catch {
    return {
      kind: "invalid",
      issues: [{ message: "Code block metadata must be a valid JSON object" }],
      metadata: { raw },
    };
  }

  if (!isPlainObject(input)) {
    return {
      kind: "invalid",
      issues: [{ message: "Code block metadata must be a JSON object" }],
      metadata: { raw },
    };
  }

  const issues: CodeBlockMetadataIssue[] = [];

  const metadata: MutableCodeBlockMetadata = { raw };

  const fileName = "fileName" in input ? input.fileName : undefined;

  if (fileName !== undefined) {
    if (!isString(fileName) || fileName.trim().length === 0) {
      issues.push({ field: "fileName", message: '"fileName" must be a non-empty string' });
    } else {
      metadata.fileName = fileName.trim();
    }
  }

  const highlighted = parseSelectionField(
    "highlightLines" in input ? input.highlightLines : undefined,
    "highlightLines",
    issues,
  );

  if (highlighted !== undefined) {
    metadata.highlightedLines = highlighted;
  }

  const commands = parseSelectionField(
    "commandLines" in input ? input.commandLines : undefined,
    "commandLines",
    issues,
  );

  if (commands !== undefined) {
    metadata.commandLines = commands;
  }

  const lineNumbers = parseLineNumbers(
    "lineNumbers" in input ? input.lineNumbers : undefined,
    issues,
  );

  if (lineNumbers !== undefined) {
    metadata.lineNumbers = lineNumbers;
  }

  if (issues.length === 0) {
    return { kind: "parsed", metadata };
  }

  return {
    kind: "invalid",
    issues,
    metadata,
  };
}

export function codeLineSelected(selection: CodeLineSelection, line: number): boolean {
  return (
    selection.kind === "all" ||
    selection.ranges.some((range) => range.start <= line && line <= range.end)
  );
}

function parseLineNumbers(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Validates a field from parsed code-block JSON before exposing typed metadata.
  value: unknown,
  issues: CodeBlockMetadataIssue[],
): CodeLineNumbers | undefined {
  if (value === undefined || value === false) {
    return;
  }

  if (value === true) {
    return { lines: allLines, start: 1 };
  }

  if (!isPlainObject(value)) {
    issues.push({
      field: "lineNumbers",
      message: '"lineNumbers" must be a boolean or an object',
    });

    return;
  }

  const start = "start" in value ? (value.start ?? 1) : 1;
  const validStart = isNumber(start) && Number.isSafeInteger(start) && start >= 1;

  if (!validStart) {
    issues.push({
      field: "lineNumbers",
      message: '"lineNumbers.start" must be a positive safe integer',
    });
  }

  const lines = parseSelectionField(
    ("lines" in value ? value.lines : undefined) ?? true,
    "lineNumbers",
    issues,
  );

  if (!validStart || lines === undefined) {
    return;
  }

  return { lines, start };
}

function parseSelectionField(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Validates a field from parsed code-block JSON before exposing typed metadata.
  value: unknown,
  field: "commandLines" | "highlightLines" | "lineNumbers",
  issues: CodeBlockMetadataIssue[],
): CodeLineSelection | undefined {
  if (value === undefined || value === false) {
    return;
  }

  if (value === true) {
    return allLines;
  }

  if (!isString(value)) {
    issues.push({ field, message: `"${field}" must be a boolean or line selector string` });

    return;
  }

  if (!selectorPattern.test(value)) {
    issues.push({ field, message: `"${field}" contains an invalid line selector` });

    return;
  }

  const ranges = value.split(",").map((part) => {
    const [startValue = "", endValue = startValue] = part.split("-");

    return { start: Number(startValue.trim()), end: Number(endValue.trim()) };
  });

  ranges.sort((left, right) => left.start - right.start || left.end - right.end);
  let previous: CodeLineRange | undefined;

  for (const range of ranges) {
    if (
      !Number.isSafeInteger(range.start) ||
      !Number.isSafeInteger(range.end) ||
      range.start < 1 ||
      range.end < range.start
    ) {
      issues.push({ field, message: `"${field}" contains an invalid line range` });

      return;
    }

    if (previous !== undefined && range.start <= previous.end) {
      issues.push({ field, message: `"${field}" contains overlapping line ranges` });

      return;
    }

    previous = range;
  }

  return { kind: "ranges", ranges };
}
