import { isPromise } from "@temelj/value";

import type { HtmlTransformContext } from "../plugin.ts";

import { ConfigurationError } from "../errors.ts";
import { HtmlCodeBlockNode, HtmlElementNode, type HtmlDocumentNode } from "../html.ts";
import { rewriteHtmlElements } from "../plugin-internal.ts";
import { HtmlTransformPlugin } from "../plugin.ts";

export interface SyntaxHighlightRequest {
  readonly code: string;
  readonly element: HtmlElementNode;
  readonly language: string;
  readonly meta?: string;
  readonly signal?: AbortSignal;
}

export interface SyntaxHighlighter {
  highlight(request: SyntaxHighlightRequest): HtmlElementNode | Promise<HtmlElementNode>;
}

export interface SyntaxHighlightPluginOptions {
  readonly highlighter: SyntaxHighlighter;
  readonly maximumCacheEntries?: number;
  readonly mode?: "strict" | "tolerant";
}

/** Highlights fenced code through a caller-supplied service and bounded cache. */
export class SyntaxHighlightPlugin extends HtmlTransformPlugin {
  public readonly name = "syntax-highlight";
  private readonly cache = new Map<string, HtmlElementNode | Promise<HtmlElementNode>>();
  private readonly highlighter: SyntaxHighlighter;
  private readonly maximumCacheEntries: number;
  private readonly mode: "strict" | "tolerant";

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
      const request = highlightRequest(node, context.signal);
      if (request === undefined) {
        return;
      }
      try {
        const result = this.highlight(request);
        return isPromise(result)
          ? Promise.resolve(result).catch((cause: unknown) =>
              this.highlightFailure(cause, request, context),
            )
          : result;
      } catch (cause) {
        return this.highlightFailure(cause, request, context);
      }
    });
  }

  private highlight(
    request: SyntaxHighlightRequest,
  ): HtmlElementNode | PromiseLike<HtmlElementNode> {
    const render = (): HtmlElementNode | PromiseLike<HtmlElementNode> =>
      this.highlighter.highlight(request);
    if (this.maximumCacheEntries === 0 || request.signal !== undefined) {
      return render();
    }
    const key = `${request.language}\0${request.meta ?? ""}\0${request.code}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const result = render();
    const cachedResult = isPromise(result)
      ? Promise.resolve(result).catch((cause: unknown) => {
          this.cache.delete(key);
          throw cause;
        })
      : result;
    this.cache.set(key, cachedResult);
    while (this.cache.size > this.maximumCacheEntries) {
      const oldest = this.cache.keys().next().value;
      if (typeof oldest !== "string") {
        break;
      }
      this.cache.delete(oldest);
    }
    return cachedResult;
  }

  private highlightFailure(
    cause: unknown,
    request: SyntaxHighlightRequest,
    context: HtmlTransformContext,
  ): undefined {
    if (this.mode === "strict") {
      throw cause;
    }
    context.diagnostics.add({
      severity: "warning",
      code: "mdx.plugin.syntax-highlight",
      message: `Could not highlight ${request.language} code: ${cause instanceof Error ? cause.message : String(cause)}`,
      span: request.element.origin,
    });
  }
}

function highlightRequest(
  element: HtmlElementNode,
  signal?: AbortSignal,
): SyntaxHighlightRequest | undefined {
  return element instanceof HtmlCodeBlockNode
    ? { element, signal, ...element.codeBlock }
    : undefined;
}
