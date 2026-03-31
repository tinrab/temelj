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
  cause?: {
    name?: string | undefined;
    message: string;
  };
}

type VFileLikeMessage = VFile["messages"][number];

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
        throw toMdxCompileError(error, sourceText, vfile.messages);
      }
    }

    const frontmatter =
      frontmatterSchema === undefined
        ? (vfile.data.matter ?? {})
        : (frontmatterSchema as z.ZodSchema).parse(vfile.data.matter ?? {});

    return {
      compiled,
      frontmatter: frontmatter as z.output<TFrontmatterSchema>,
      messages: normalizeMessages(vfile.messages, sourceText),
    };
  }
}

function toMdxCompileError(
  error: unknown,
  sourceText: string,
  diagnostics: readonly VFileLikeMessage[],
): MdxCompileError {
  const details = getDiagnosticDetails(sourceText, getErrorPlace(error), error);

  return new MdxCompileError(getErrorReason(error), {
    source: getErrorField(error, "source"),
    ruleId: getErrorField(error, "ruleId"),
    line: details.line,
    column: details.column,
    place: details.place,
    sourceLine: details.sourceLine,
    snippet: details.snippet,
    diagnostics: normalizeMessages(diagnostics, sourceText),
    cause: error,
  });
}

function normalizeMessages(
  messages: readonly VFileLikeMessage[],
  sourceText: string,
): MdxMessage[] {
  return messages.map((message) => {
    const details = getDiagnosticDetails(
      sourceText,
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
  }
  if (
    options.causeMessage !== undefined &&
    options.causeMessage !== "" &&
    options.causeMessage !== reason
  ) {
    lines.push(`Cause: ${options.causeMessage}`);
  }

  return lines.join("\n");
}

function getDiagnosticDetails(
  sourceText: string,
  place: MdxMessagePlace | undefined,
  error: unknown,
): {
  line?: number | undefined;
  column?: number | undefined;
  place?: MdxMessagePlace | undefined;
  sourceLine?: string | undefined;
  snippet?: string | undefined;
} {
  const line = place?.start?.line ?? getErrorNumberField(error, "line");
  const column = place?.start?.column ?? getErrorNumberField(error, "column");
  const normalizedPlace =
    line === undefined && column === undefined && place === undefined
      ? undefined
      : {
          start: {
            line,
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
        };

  return {
    line,
    column,
    place: normalizedPlace,
    sourceLine: getSourceLine(sourceText, line),
    snippet: getSourceSnippet(sourceText, normalizedPlace),
  };
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
