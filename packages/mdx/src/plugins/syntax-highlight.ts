import { isPromise } from "@temelj/value";

import type { HtmlCodeBlockNode, HtmlElementNode, HtmlRootNode } from "../html.ts";
import type { HtmlPlugin, HtmlPluginContext, PluginFailureMode } from "../plugin.ts";
import type { CodeBlockMetadata } from "./code-block-metadata.ts";

import { ConfigurationError } from "../errors.ts";
import { replaceHtmlNodes } from "../plugin-internal.ts";
import { CodeBlockMetadataError, parseCodeBlockMetadata } from "./code-block-metadata.ts";

export interface SyntaxHighlightRequest {
  readonly code: string;
  readonly language: string;
  readonly metadata: CodeBlockMetadata;
  readonly signal?: AbortSignal;
}

export interface SynchronousSyntaxHighlighter {
  readonly kind: "synchronous";
  highlight(request: SyntaxHighlightRequest): HtmlElementNode | undefined;
}

export interface AsynchronousSyntaxHighlighter {
  readonly kind: "asynchronous";
  highlight(request: SyntaxHighlightRequest): Promise<HtmlElementNode | undefined>;
}

export type SyntaxHighlighter = SynchronousSyntaxHighlighter | AsynchronousSyntaxHighlighter;

export interface SyntaxHighlightPluginOptions {
  readonly highlighter: SyntaxHighlighter;
  readonly maximumCacheEntries?: number;
  readonly mode?: PluginFailureMode;
}

type CachedHighlight = HtmlElementNode | Promise<HtmlElementNode | undefined>;

/** Highlights fenced code through a caller-supplied service and bounded cache. */
export class SyntaxHighlightPlugin implements HtmlPlugin {
  public readonly name = "syntax-highlight";
  private readonly cache = new Map<string, CachedHighlight>();
  private readonly highlighter: SyntaxHighlighter;
  private readonly maximumCacheEntries: number;
  private readonly mode: PluginFailureMode;

  public constructor(options: SyntaxHighlightPluginOptions) {
    const maximum = options.maximumCacheEntries ?? 128;

    if (!Number.isSafeInteger(maximum) || maximum < 0) {
      throw ConfigurationError.invalidCacheCapacity("syntax-highlight", maximum);
    }

    this.highlighter = options.highlighter;
    this.maximumCacheEntries = maximum;
    this.mode = options.mode ?? "tolerant";
  }

  public transform(context: HtmlPluginContext): HtmlRootNode | Promise<HtmlRootNode> {
    return replaceHtmlNodes(context.root, (node) => {
      if (node.kind !== "codeBlock") {
        return;
      }

      let metadata: CodeBlockMetadata;

      try {
        metadata = parseCodeBlockMetadata(node.meta);
      } catch (error) {
        if (!(error instanceof CodeBlockMetadataError) || this.mode === "strict") {
          throw error;
        }

        metadata = error.metadata;

        for (const issue of error.issues) {
          context.diagnostics.add({
            severity: "warning",
            code: "mdx.plugin.syntax-highlight.meta",
            message: issue.message,
            span: span(node, context),
          });
        }
      }

      const request: SyntaxHighlightRequest = {
        code: node.code,
        language: node.language,
        metadata,
        signal: context.signal,
      };

      try {
        const result = this.highlight(request);

        return isPromise(result)
          ? result.then(
              (element) => anchor(element, node),
              (cause: unknown) => this.highlightFailure(cause, node, context),
            )
          : anchor(result, node);
      } catch (cause) {
        return this.highlightFailure(cause, node, context);
      }
    });
  }

  private highlight(
    request: SyntaxHighlightRequest,
  ): HtmlElementNode | undefined | Promise<HtmlElementNode | undefined> {
    if (this.maximumCacheEntries === 0 || request.signal !== undefined) {
      return this.highlighter.highlight(request);
    }

    const key = JSON.stringify([request.language, request.metadata.raw, request.code]);
    const cached = this.cache.get(key);

    if (cached !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, cached);

      return cached;
    }

    const result = this.highlighter.highlight(request);

    if (result === undefined) {
      return;
    }

    const cachedResult = isPromise(result)
      ? result.then(
          (element) => {
            if (element === undefined) {
              this.cache.delete(key);
            }

            return element;
          },
          (cause: unknown) => {
            this.cache.delete(key);
            throw cause;
          },
        )
      : result;

    this.cache.set(key, cachedResult);

    if (this.cache.size > this.maximumCacheEntries) {
      const oldest = this.cache.keys().next().value;

      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }

    return cachedResult;
  }

  private highlightFailure(
    cause: unknown,
    node: HtmlCodeBlockNode,
    context: HtmlPluginContext,
  ): undefined {
    context.signal?.throwIfAborted();

    if (this.mode === "strict") {
      throw cause;
    }

    context.diagnostics.add({
      severity: "warning",
      code: "mdx.plugin.syntax-highlight",
      message: `Could not highlight ${node.language} code: ${cause instanceof Error ? cause.message : String(cause)}`,
      span: span(node, context),
    });
  }
}

function anchor(
  highlighted: HtmlElementNode | undefined,
  source: HtmlCodeBlockNode,
): HtmlElementNode | undefined {
  return highlighted === undefined ? undefined : { ...highlighted, origin: source.origin };
}

function span(
  node: HtmlCodeBlockNode,
  context: HtmlPluginContext,
): Readonly<{ file: HtmlPluginContext["file"]; start: number; end: number }> | undefined {
  return node.origin === undefined
    ? undefined
    : { file: context.file, start: node.origin.start, end: node.origin.end };
}
