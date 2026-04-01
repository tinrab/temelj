import {
  compile as compileMdxJs,
  type CompileOptions as MdxJsCompileOptions,
} from "@mdx-js/mdx";
import remarkFrontmatterPlugin from "remark-frontmatter";
import remarkGfmPlugin from "remark-gfm";
import type { Pluggable, PluggableList, Plugin } from "unified";
import { VFile } from "vfile";
import { matter } from "vfile-matter";
import type { z } from "zod";

import type { HastNode } from "./types";

export { remarkFrontmatterPlugin, remarkGfmPlugin };

/**
 * Represents the source content for an MDX document.
 */
export type MdxSource = string | Uint8Array;

/**
 * Options for compiling an MDX document.
 */
export interface MdxCompileOptions {
  frontmatterOnly?: boolean | undefined;
  mdxOptions?: MdxJsCompileOptions;
}

export interface MdxMessagePoint {
  line?: number | undefined;
  column?: number | undefined;
  offset?: number | undefined;
}

export interface MdxMessagePlace {
  start?: MdxMessagePoint | undefined;
  end?: MdxMessagePoint | undefined;
}

export interface MdxMessage {
  message: string;
  reason: string;
  source?: string | undefined;
  ruleId?: string | undefined;
  fatal?: boolean | undefined;
  line?: number | undefined;
  column?: number | undefined;
  place?: MdxMessagePlace | undefined;
  sourceLine?: string | undefined;
  snippet?: string | undefined;
  sourcePointer?: string | undefined;
  hint?: string | undefined;
  cause?: {
    name?: string | undefined;
    message: string;
  };
}

type VFileLikeMessage = VFile["messages"][number];

interface MdxDiagnosticSourceContext {
  originalSourceText: string;
  lineOffset: number;
}

/**
 * The result of compiling an MDX document.
 * Compiled content is optional, because sometimes we only need the frontmatter.
 */
export interface MdxArtifact<TFrontmatter = Record<string, unknown>> {
  compiled?: string | undefined;
  frontmatter: TFrontmatter;
  messages: MdxMessage[];
}

export class MdxCompileError extends Error {
  public readonly reason: string;
  public readonly source?: string | undefined;
  public readonly ruleId?: string | undefined;
  public readonly line?: number | undefined;
  public readonly column?: number | undefined;
  public readonly place?: MdxMessagePlace | undefined;
  public readonly sourceLine?: string | undefined;
  public readonly snippet?: string | undefined;
  public readonly sourcePointer?: string | undefined;
  public readonly hint?: string | undefined;
  public readonly diagnostics: MdxMessage[];

  public constructor(
    reason: string,
    options: {
      source?: string | undefined;
      ruleId?: string | undefined;
      line?: number | undefined;
      column?: number | undefined;
      place?: MdxMessagePlace | undefined;
      sourceLine?: string | undefined;
      snippet?: string | undefined;
      sourcePointer?: string | undefined;
      hint?: string | undefined;
      causeMessage?: string | undefined;
      diagnostics?: MdxMessage[] | undefined;
      cause?: unknown;
    } = {},
  ) {
    super(
      formatDiagnosticMessage(reason, {
        source: options.source,
        ruleId: options.ruleId,
        line: options.line,
        column: options.column,
        sourceLine: options.sourceLine,
        snippet: options.snippet,
        sourcePointer: options.sourcePointer,
        hint: options.hint,
        causeMessage: options.causeMessage,
      }),
      options.cause === undefined ? undefined : { cause: options.cause },
    );

    this.name = "MdxCompileError";
    this.reason = reason;
    this.source = options.source;
    this.ruleId = options.ruleId;
    this.line = options.line;
    this.column = options.column;
    this.place = options.place;
    this.sourceLine = options.sourceLine;
    this.snippet = options.snippet;
    this.sourcePointer = options.sourcePointer;
    this.hint = options.hint;
    this.diagnostics = options.diagnostics ?? [];
  }
}

/**
 * A reusable compiler for compiling MDX.
 */
export class MdxCompiler {
  private readonly mdxOptions: MdxJsCompileOptions;
  private readonly remarkPlugins: PluggableList;
  private readonly rehypePlugins: PluggableList;

  public constructor(mdxOptions: MdxJsCompileOptions = {}) {
    this.mdxOptions = mdxOptions;
    this.remarkPlugins = [remarkFrontmatterPlugin, remarkGfmPlugin];
    this.rehypePlugins = [];
  }

  public withRemarkPlugin<TOptions>(
    plugin: Plugin<[TOptions?], HastNode, HastNode>,
    options?: TOptions,
  ): MdxCompiler {
    if (options === undefined) {
      this.remarkPlugins.push(plugin as Pluggable);
    } else {
      this.remarkPlugins.push([plugin, options] as Pluggable);
    }
    return this;
  }

  public withRehypePlugin<TOptions>(
    plugin: Plugin<[TOptions?], HastNode, HastNode>,
    options?: TOptions,
  ): MdxCompiler {
    if (options === undefined) {
      this.rehypePlugins.push(plugin as Pluggable);
    } else {
      this.rehypePlugins.push([plugin, options] as Pluggable);
    }
    return this;
  }

  public async compile<TFrontmatterSchema extends z.ZodSchema>(
    source: MdxSource,
    { frontmatterOnly = false, mdxOptions }: MdxCompileOptions = {},
    frontmatterSchema?: TFrontmatterSchema,
  ): Promise<MdxArtifact<z.output<TFrontmatterSchema>>> {
    const sourceText = toSourceText(source);
    const vfile = new VFile({
      value: source,
      // Needed so vfile doesn't need to access fs.
      cwd: "/",
      path: "/source.mdx",
    });
    matter(vfile, { strip: true });
    const compileSourceText = toSourceText(vfile.value as MdxSource);
    const sourceContext = createDiagnosticSourceContext(
      sourceText,
      compileSourceText,
    );

    const remarkPlugins = [
      ...this.remarkPlugins,
      ...(this.mdxOptions?.remarkPlugins ?? []),
      ...(mdxOptions?.remarkPlugins ?? []),
    ];
    const rehypePlugins = [
      ...this.rehypePlugins,
      ...(this.mdxOptions?.rehypePlugins ?? []),
      ...(mdxOptions?.rehypePlugins ?? []),
    ];

    let compiled: string | undefined;
    if (!frontmatterOnly) {
      try {
        const compiledFile = await compileMdxJs(vfile, {
          outputFormat: "function-body",
          ...(this.mdxOptions ?? {}),
          ...(mdxOptions ?? {}),
          remarkPlugins,
          rehypePlugins,
        });
        compiled = compiledFile.value.toString();
      } catch (error) {
        throw toMdxCompileError(error, sourceContext, vfile.messages);
      }
    }

    const frontmatter =
      frontmatterSchema === undefined
        ? (vfile.data.matter ?? {})
        : (frontmatterSchema as z.ZodSchema).parse(vfile.data.matter ?? {});

    return {
      compiled,
      frontmatter: frontmatter as z.output<TFrontmatterSchema>,
      messages: normalizeMessages(vfile.messages, sourceContext),
    };
  }
}

function toMdxCompileError(
  error: unknown,
  sourceContext: MdxDiagnosticSourceContext,
  diagnostics: readonly VFileLikeMessage[],
): MdxCompileError {
  const details = getDiagnosticDetails(
    sourceContext,
    getErrorPlace(error),
    error,
  );
  const cause = getErrorCause(error);

  return new MdxCompileError(getErrorReason(error), {
    source: getErrorField(error, "source"),
    ruleId: getErrorField(error, "ruleId"),
    line: details.line,
    column: details.column,
    place: details.place,
    sourceLine: details.sourceLine,
    snippet: details.snippet,
    sourcePointer: details.sourcePointer,
    hint: details.hint,
    causeMessage: cause?.message,
    diagnostics: normalizeMessages(diagnostics, sourceContext),
    cause: error,
  });
}

function normalizeMessages(
  messages: readonly VFileLikeMessage[],
  sourceContext: MdxDiagnosticSourceContext,
): MdxMessage[] {
  return messages.map((message) => {
    const details = getDiagnosticDetails(
      sourceContext,
      toMessagePlace(message),
      message,
    );
    const reason = getErrorReason(message);
    const source = getErrorField(message, "source");
    const ruleId = getErrorField(message, "ruleId");
    const cause = getErrorCause(message);

    return {
      message: formatDiagnosticMessage(reason, {
        source,
        ruleId,
        line: details.line,
        column: details.column,
        sourceLine: details.sourceLine,
        snippet: details.snippet,
        sourcePointer: details.sourcePointer,
        hint: details.hint,
        causeMessage: cause?.message,
      }),
      reason,
      source,
      ruleId,
      fatal: typeof message.fatal === "boolean" ? message.fatal : undefined,
      line: details.line,
      column: details.column,
      place: details.place,
      sourceLine: details.sourceLine,
      snippet: details.snippet,
      sourcePointer: details.sourcePointer,
      hint: details.hint,
      cause,
    };
  });
}

function formatDiagnosticMessage(
  reason: string,
  options: {
    source?: string | undefined;
    ruleId?: string | undefined;
    line?: number | undefined;
    column?: number | undefined;
    sourceLine?: string | undefined;
    snippet?: string | undefined;
    sourcePointer?: string | undefined;
    hint?: string | undefined;
    causeMessage?: string | undefined;
  },
): string {
  const origin =
    options.source === undefined
      ? undefined
      : options.ruleId === undefined
        ? options.source
        : `${options.source}:${options.ruleId}`;
  const location =
    options.line === undefined
      ? undefined
      : options.column === undefined
        ? `at ${options.line}`
        : `at ${options.line}:${options.column}`;

  const lines = [[reason, origin, location].filter(Boolean).join(" ")];

  if (options.snippet !== undefined) {
    lines.push(`Source: ${options.snippet}`);
  }
  if (
    options.sourceLine !== undefined &&
    options.sourceLine !== options.snippet
  ) {
    lines.push(`Line: ${options.sourceLine}`);
    if (options.sourcePointer !== undefined) {
      lines.push(`      ${options.sourcePointer}`);
    }
  }
  if (
    options.causeMessage !== undefined &&
    options.causeMessage !== "" &&
    options.causeMessage !== reason
  ) {
    lines.push(`Cause: ${options.causeMessage}`);
  }
  if (options.hint !== undefined) {
    lines.push(`Hint: ${options.hint}`);
  }

  return lines.join("\n");
}

function getDiagnosticDetails(
  sourceContext: MdxDiagnosticSourceContext,
  place: MdxMessagePlace | undefined,
  error: unknown,
): {
  line?: number | undefined;
  column?: number | undefined;
  place?: MdxMessagePlace | undefined;
  sourceLine?: string | undefined;
  snippet?: string | undefined;
  sourcePointer?: string | undefined;
  hint?: string | undefined;
} {
  const compileLine = place?.start?.line ?? getErrorNumberField(error, "line");
  let line =
    compileLine === undefined
      ? undefined
      : compileLine + sourceContext.lineOffset;
  let column = place?.start?.column ?? getErrorNumberField(error, "column");
  let normalizedPlace = mapPlaceToOriginalSource(
    place === undefined && compileLine === undefined && column === undefined
      ? undefined
      : {
          start: {
            line: compileLine,
            column,
            offset: place?.start?.offset,
          },
          end:
            place?.end === undefined
              ? undefined
              : {
                  line: place.end.line,
                  column: place.end.column,
                  offset: place.end.offset,
                },
        },
    sourceContext.lineOffset,
  );
  let sourceLine = getSourceLine(sourceContext.originalSourceText, line);
  let snippet = getSourceSnippet(
    sourceContext.originalSourceText,
    normalizedPlace,
  );
  let sourcePointer = getSourcePointer(column);
  let hint: string | undefined;

  const refinedExpressionContext = getMdxExpressionContext(
    sourceContext.originalSourceText,
    {
      line,
      column,
      sourceLine,
      snippet,
      error,
    },
  );

  if (refinedExpressionContext !== undefined) {
    line = refinedExpressionContext.line;
    column = refinedExpressionContext.column;
    sourceLine = refinedExpressionContext.sourceLine;
    snippet = refinedExpressionContext.snippet;
    sourcePointer = refinedExpressionContext.sourcePointer;
    hint = refinedExpressionContext.hint;
    normalizedPlace = {
      start: {
        line,
        column,
        offset: undefined,
      },
      end: undefined,
    };
  }

  return {
    line,
    column,
    place: normalizedPlace,
    sourceLine,
    snippet,
    sourcePointer,
    hint,
  };
}

function getMdxExpressionContext(
  sourceText: string,
  options: {
    line?: number | undefined;
    column?: number | undefined;
    sourceLine?: string | undefined;
    snippet?: string | undefined;
    error: unknown;
  },
):
  | {
      line: number;
      column: number;
      sourceLine: string;
      snippet: string;
      sourcePointer: string;
      hint?: string | undefined;
    }
  | undefined {
  if (!shouldRefineMdxExpressionContext(options)) {
    return undefined;
  }

  const candidate = findSuspiciousBraceExpression(
    sourceText,
    options.line,
    options.column,
  );
  if (candidate === undefined) {
    return undefined;
  }

  return {
    line: candidate.line,
    column: candidate.column,
    sourceLine: candidate.sourceLine,
    snippet: candidate.snippet,
    sourcePointer: getSourcePointer(candidate.column) ?? "^",
    hint:
      getErrorCause(options.error)?.message ===
      "Unexpected content after expression"
        ? "MDX treats `{...}` as JavaScript. If you meant literal braces in text, escape them or wrap the text in code."
        : undefined,
  };
}

function shouldRefineMdxExpressionContext(options: {
  sourceLine?: string | undefined;
  snippet?: string | undefined;
  error: unknown;
}): boolean {
  const trimmedSourceLine = options.sourceLine?.trim();

  return (
    isMdxExpressionError(options.error) &&
    getErrorCause(options.error)?.message ===
      "Unexpected content after expression" &&
    (options.sourceLine === undefined ||
      options.sourceLine.trim() === "" ||
      options.snippet === undefined) &&
    !(trimmedSourceLine?.startsWith("{") && trimmedSourceLine.endsWith("}"))
  );
}

function getSourceLine(
  sourceText: string,
  line: number | undefined,
): string | undefined {
  if (line === undefined || line < 1) {
    return undefined;
  }
  return sourceText.split(/\r?\n/u)[line - 1];
}

function getSourceSnippet(
  sourceText: string,
  place: MdxMessagePlace | undefined,
): string | undefined {
  if (place?.start?.offset !== undefined && place.end?.offset !== undefined) {
    return sourceText.slice(place.start.offset, place.end.offset) || undefined;
  }

  if (place?.start?.line === undefined || place.start.column === undefined) {
    return undefined;
  }

  if (place.end === undefined) {
    const lines = sourceText.split(/\r?\n/u);
    const line = lines[place.start.line - 1];
    if (line === undefined) {
      return undefined;
    }

    const character = line.at(place.start.column - 1);
    return character === undefined || character.trim() === ""
      ? undefined
      : character;
  }

  const lines = sourceText.split(/\r?\n/u);
  const startLineIndex = place.start.line - 1;
  const endLineIndex = (place.end?.line ?? place.start.line) - 1;

  if (startLineIndex < 0 || startLineIndex >= lines.length) {
    return undefined;
  }

  const selectedLines = lines.slice(startLineIndex, endLineIndex + 1);
  if (selectedLines.length === 0) {
    return undefined;
  }

  selectedLines[0] = selectedLines[0].slice(place.start.column - 1);

  const endColumn = place.end?.column;
  if (endColumn !== undefined) {
    const lastIndex = selectedLines.length - 1;
    selectedLines[lastIndex] = selectedLines[lastIndex].slice(0, endColumn - 1);
  }

  return selectedLines.join("\n") || undefined;
}

function getSourcePointer(column: number | undefined): string | undefined {
  if (column === undefined || column < 1) {
    return undefined;
  }

  return `${" ".repeat(column - 1)}^`;
}

function mapPlaceToOriginalSource(
  place: MdxMessagePlace | undefined,
  lineOffset: number,
): MdxMessagePlace | undefined {
  if (place === undefined) {
    return undefined;
  }

  return {
    start: mapPointToOriginalSource(place.start, lineOffset),
    end: mapPointToOriginalSource(place.end, lineOffset),
  };
}

function mapPointToOriginalSource(
  point: MdxMessagePoint | undefined,
  lineOffset: number,
): MdxMessagePoint | undefined {
  if (point === undefined) {
    return undefined;
  }

  return {
    line: point.line === undefined ? undefined : point.line + lineOffset,
    column: point.column,
    offset: lineOffset === 0 ? point.offset : undefined,
  };
}

function findSuspiciousBraceExpression(
  sourceText: string,
  line: number | undefined,
  column: number | undefined,
):
  | {
      line: number;
      column: number;
      sourceLine: string;
      snippet: string;
    }
  | undefined {
  const lines = sourceText.split(/\r?\n/u);
  const searchLines = getNearbyLineNumbers(line, lines.length, 2);
  let bestMatch:
    | {
        line: number;
        column: number;
        sourceLine: string;
        snippet: string;
        score: number;
      }
    | undefined;

  for (const lineNumber of searchLines) {
    const sourceLine = lines[lineNumber - 1];
    if (sourceLine === undefined || sourceLine.trim() === "") {
      continue;
    }

    const expression = findLineBraceExpression(sourceLine, lineNumber, column);
    if (expression === undefined) {
      continue;
    }

    const lineDistance = line === undefined ? 0 : Math.abs(lineNumber - line);
    const score = lineDistance * 10 + expression.distance;

    if (bestMatch === undefined || score < bestMatch.score) {
      bestMatch = {
        ...expression,
        score,
      };
    }
  }

  return bestMatch;
}

function getNearbyLineNumbers(
  line: number | undefined,
  totalLines: number,
  radius: number,
): number[] {
  if (line === undefined) {
    return Array.from({ length: totalLines }, (_, index) => index + 1);
  }

  const lineNumbers: number[] = [];
  for (let distance = 0; distance <= radius; distance++) {
    const before = line - distance;
    if (before >= 1) {
      lineNumbers.push(before);
    }

    if (distance === 0) {
      continue;
    }

    const after = line + distance;
    if (after <= totalLines) {
      lineNumbers.push(after);
    }
  }

  return lineNumbers;
}

function findLineBraceExpression(
  sourceLine: string,
  line: number,
  column: number | undefined,
):
  | {
      line: number;
      column: number;
      sourceLine: string;
      snippet: string;
      distance: number;
    }
  | undefined {
  let bestMatch:
    | {
        line: number;
        column: number;
        sourceLine: string;
        snippet: string;
        distance: number;
      }
    | undefined;

  for (const match of sourceLine.matchAll(/\{[^{}\n]+\}/gu)) {
    const braceStart = match.index;
    if (braceStart === undefined) {
      continue;
    }

    const expanded = expandBraceExpression(sourceLine, braceStart);
    if (expanded === undefined) {
      continue;
    }

    const distance =
      column === undefined ? 0 : Math.abs(braceStart + 1 - column);
    if (bestMatch === undefined || distance < bestMatch.distance) {
      bestMatch = {
        line,
        column: braceStart + 1,
        sourceLine,
        snippet: expanded,
        distance,
      };
    }
  }

  return bestMatch;
}

function expandBraceExpression(
  sourceLine: string,
  braceStart: number,
): string | undefined {
  const braceEnd = sourceLine.indexOf("}", braceStart);
  if (braceEnd === -1) {
    return undefined;
  }

  let start = braceStart;
  while (start > 0 && /[A-Za-z0-9_]/u.test(sourceLine[start - 1])) {
    start--;
  }

  let end = braceEnd + 1;
  while (end < sourceLine.length) {
    while (end < sourceLine.length && /[A-Za-z0-9_]/u.test(sourceLine[end])) {
      end++;
    }

    if (sourceLine[end] !== "{") {
      break;
    }

    const chainedEnd = sourceLine.indexOf("}", end);
    if (chainedEnd === -1) {
      break;
    }
    end = chainedEnd + 1;
  }

  return sourceLine.slice(start, end) || undefined;
}

function isMdxExpressionError(error: unknown): boolean {
  return (
    getErrorField(error, "source") === "micromark-extension-mdx-expression" &&
    getErrorField(error, "ruleId") === "acorn"
  );
}

function createDiagnosticSourceContext(
  originalSourceText: string,
  compileSourceText: string,
): MdxDiagnosticSourceContext {
  return {
    originalSourceText,
    lineOffset: getSourceLineOffset(originalSourceText, compileSourceText),
  };
}

function getSourceLineOffset(
  originalSourceText: string,
  compileSourceText: string,
): number {
  const originalLines = originalSourceText.split(/\r?\n/u);
  const compileLines = compileSourceText.split(/\r?\n/u);
  const maxOffset = originalLines.length - compileLines.length;

  for (let offset = 0; offset <= maxOffset; offset++) {
    let isMatch = true;
    for (let index = 0; index < compileLines.length; index++) {
      if (originalLines[offset + index] !== compileLines[index]) {
        isMatch = false;
        break;
      }
    }

    if (isMatch) {
      return offset;
    }
  }

  return maxOffset > 0 ? maxOffset : 0;
}

function getErrorPlace(error: unknown): MdxMessagePlace | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const candidate = error as {
    place?: unknown;
    position?: unknown;
  };

  return toPlace(candidate.place) ?? toPlace(candidate.position);
}

function toMessagePlace(
  message: VFileLikeMessage,
): MdxMessagePlace | undefined {
  return toPlace(message.place);
}

function toPlace(value: unknown): MdxMessagePlace | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const candidate = value as {
    start?: unknown;
    end?: unknown;
    line?: unknown;
    column?: unknown;
    offset?: unknown;
  };

  if (candidate.start !== undefined || candidate.end !== undefined) {
    return {
      start: toPoint(candidate.start),
      end: toPoint(candidate.end),
    };
  }

  const point = toPoint(candidate);
  return point === undefined ? undefined : { start: point };
}

function toPoint(value: unknown): MdxMessagePoint | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const candidate = value as {
    line?: unknown;
    column?: unknown;
    offset?: unknown;
  };
  const line = typeof candidate.line === "number" ? candidate.line : undefined;
  const column =
    typeof candidate.column === "number" ? candidate.column : undefined;
  const offset =
    typeof candidate.offset === "number" ? candidate.offset : undefined;

  if (line === undefined && column === undefined && offset === undefined) {
    return undefined;
  }

  return { line, column, offset };
}

function getErrorReason(error: unknown): string {
  if (error instanceof Error && error.message !== "") {
    return error.message;
  }

  const reason = getErrorField(error, "reason");
  if (reason !== undefined && reason !== "") {
    return reason;
  }

  return String(error);
}

function getErrorCause(
  error: unknown,
): { name?: string | undefined; message: string } | undefined {
  if (typeof error !== "object" || error === null || !("cause" in error)) {
    return undefined;
  }

  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    return {
      name: cause.name,
      message: cause.message,
    };
  }
  if (typeof cause === "string" && cause !== "") {
    return {
      message: cause,
    };
  }

  return undefined;
}

function getErrorField(
  error: unknown,
  field: "source" | "ruleId" | "reason",
): string | undefined {
  if (typeof error !== "object" || error === null || !(field in error)) {
    return undefined;
  }

  const value = (error as Record<string, unknown>)[field];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function getErrorNumberField(
  error: unknown,
  field: "line" | "column",
): number | undefined {
  if (typeof error !== "object" || error === null || !(field in error)) {
    return undefined;
  }

  const value = (error as Record<string, unknown>)[field];
  return typeof value === "number" ? value : undefined;
}

function toSourceText(source: MdxSource): string {
  return typeof source === "string" ? source : new TextDecoder().decode(source);
}
