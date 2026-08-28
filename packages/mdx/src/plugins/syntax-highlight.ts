import { isPromise } from "@temelj/value";

import type { HtmlTransformContext } from "../plugin.ts";
import type { CodeBlockMetadata, CodeBlockMetadataIssue } from "./code-block-metadata.ts";

import { ConfigurationError } from "../errors.ts";
import { HtmlCodeBlockNode, HtmlElementNode, type HtmlDocumentNode } from "../html.ts";
import { rewriteHtmlElements } from "../plugin-internal.ts";
import { HtmlTransformPlugin } from "../plugin.ts";
import { parseCodeBlockMetadata } from "./code-block-metadata.ts";

export type SyntaxHighlightMode = "strict" | "tolerant";

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
  readonly mode?: SyntaxHighlightMode;
}

type CachedHighlight = HtmlElementNode | Promise<HtmlElementNode | undefined>;

/** Highlights fenced code through a caller-supplied service and bounded cache. */
export class SyntaxHighlightPlugin extends HtmlTransformPlugin {
  public readonly name = "syntax-highlight";
  private readonly cache = new Map<string, CachedHighlight>();
  private readonly highlighter: SyntaxHighlighter;
  private readonly maximumCacheEntries: number;
  private readonly mode: SyntaxHighlightMode;

  public constructor(options: SyntaxHighlightPluginOptions) {
    super();
    const maximum = options.maximumCacheEntries ?? 128;
    if (!Number.isSafeInteger(maximum) || maximum < 0) {
      ConfigurationError.invalidCacheCapacity("syntax-highlight", maximum);
    }
    this.highlighter = options.highlighter;
    this.maximumCacheEntries = maximum;
    this.mode = options.mode ?? "tolerant";
  }

  public transform(context: HtmlTransformContext): HtmlDocumentNode | Promise<HtmlDocumentNode> {
    return rewriteHtmlElements(context.document, (node) => {
      if (!(node instanceof HtmlCodeBlockNode)) {
        return;
      }
      const metadata = parseCodeBlockMetadata(node.codeBlock.meta);
      if (metadata.kind === "invalid") {
        if (this.mode === "strict") {
          throw new SyntaxHighlightMetadataError(metadata.issues);
        }
        for (const issue of metadata.issues) {
          context.diagnostics.add({
            severity: "warning",
            code: "mdx.plugin.syntax-highlight.meta",
            message: issue.message,
            span: node.origin,
          });
        }
      }
      const request: SyntaxHighlightRequest = {
        code: node.codeBlock.code,
        language: node.codeBlock.language,
        metadata: metadata.metadata,
        signal: context.signal,
      };
      try {
        const result = this.highlight(request);
        return isPromise(result)
          ? result
              .then((element) => anchorHighlight(element, node))
              .catch((cause: unknown) => this.highlightFailure(cause, request, node, context))
          : anchorHighlight(result, node);
      } catch (cause) {
        return this.highlightFailure(cause, request, node, context);
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
      ? result
          .then((element) => {
            if (element === undefined) {
              this.cache.delete(key);
            }
            return element;
          })
          .catch((cause: unknown) => {
            this.cache.delete(key);
            throw cause;
          })
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
    request: SyntaxHighlightRequest,
    node: HtmlCodeBlockNode,
    context: HtmlTransformContext,
  ): undefined {
    context.signal?.throwIfAborted();
    if (this.mode === "strict") {
      throw cause;
    }
    context.diagnostics.add({
      severity: "warning",
      code: "mdx.plugin.syntax-highlight",
      message: `Could not highlight ${request.language} code: ${cause instanceof Error ? cause.message : String(cause)}`,
      span: node.origin,
    });
  }
}

export class SyntaxHighlightMetadataError extends Error {
  public readonly issues: readonly CodeBlockMetadataIssue[];

  public constructor(issues: readonly CodeBlockMetadataIssue[]) {
    super(issues.map((issue) => issue.message).join("; "));
    this.name = "SyntaxHighlightMetadataError";
    this.issues = [...issues];
  }
}

function anchorHighlight(
  highlighted: HtmlElementNode | undefined,
  source: HtmlCodeBlockNode,
): HtmlElementNode | undefined {
  return highlighted === undefined
    ? undefined
    : new HtmlElementNode(
        highlighted.tagName,
        highlighted.attributes,
        highlighted.children,
        source.origin,
      );
}
