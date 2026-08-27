import { isPromise } from "@temelj/value";

import type { HtmlTransformContext } from "../plugin.ts";

import {
  HtmlElementNode,
  HtmlMathNode,
  type HtmlDocumentNode,
  type MathRenderInput,
} from "../html.ts";
import { rewriteHtmlElements } from "../plugin-internal.ts";
import { HtmlTransformPlugin } from "../plugin.ts";

export type MathRenderMode = "strict" | "tolerant";
export type { MathRenderInput, MathRenderStyle } from "../html.ts";

export interface MathRenderRequest extends MathRenderInput {
  readonly element: HtmlMathNode;
  readonly signal?: AbortSignal;
}

export interface MathRenderer {
  render(request: MathRenderRequest): HtmlElementNode | Promise<HtmlElementNode>;
}

export interface MathRenderPluginOptions {
  readonly mode?: MathRenderMode;
  readonly renderer: MathRenderer;
}

/** Renders owned math HTML through a caller-supplied renderer. */
export class MathRenderPlugin extends HtmlTransformPlugin {
  public readonly name = "math-render";
  private readonly mode: MathRenderMode;
  private readonly renderer: MathRenderer;

  public constructor(options: MathRenderPluginOptions) {
    super();
    this.renderer = options.renderer;
    this.mode = options.mode ?? "tolerant";
  }

  public transform(context: HtmlTransformContext): HtmlDocumentNode | Promise<HtmlDocumentNode> {
    return rewriteHtmlElements(context.document, (node) => {
      if (!(node instanceof HtmlMathNode)) {
        return;
      }
      const request: MathRenderRequest = { element: node, signal: context.signal, ...node.math };
      try {
        const result = this.renderer.render(request);
        return isPromise(result)
          ? Promise.resolve(result).catch((cause: unknown) =>
              this.renderFailure(cause, request, context),
            )
          : result;
      } catch (cause) {
        return this.renderFailure(cause, request, context);
      }
    });
  }

  private renderFailure(
    cause: unknown,
    request: MathRenderRequest,
    context: HtmlTransformContext,
  ): undefined {
    if (this.mode === "strict") {
      throw cause;
    }
    context.diagnostics.add({
      severity: "warning",
      code: "mdx.plugin.math-render",
      message: `Could not render ${request.style} math: ${cause instanceof Error ? cause.message : String(cause)}`,
      span: request.element.origin,
    });
  }
}
