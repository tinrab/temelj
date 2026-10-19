import { isPromise } from "@temelj/value";

import type { HtmlMathNode, HtmlNode, HtmlRootNode } from "../html.ts";
import type { HtmlPlugin, HtmlPluginContext, PluginFailureMode } from "../plugin.ts";

import { replaceHtmlNodes } from "../plugin-internal.ts";

export interface MathRenderRequest {
  readonly node: HtmlMathNode;
  readonly signal?: AbortSignal;
}

export interface MathRenderer {
  /** Returns the node that replaces the math fallback. */
  render(request: MathRenderRequest): HtmlNode | Promise<HtmlNode>;
}

export interface MathRenderPluginOptions {
  readonly mode?: PluginFailureMode;
  readonly renderer: MathRenderer;
}

/** Renders math nodes through a caller-supplied renderer. */
export class MathRenderPlugin implements HtmlPlugin {
  public readonly name = "math-render";
  private readonly mode: PluginFailureMode;
  private readonly renderer: MathRenderer;

  public constructor(options: MathRenderPluginOptions) {
    this.renderer = options.renderer;
    this.mode = options.mode ?? "tolerant";
  }

  public transform(context: HtmlPluginContext): HtmlRootNode | Promise<HtmlRootNode> {
    return replaceHtmlNodes(context.root, (node) => {
      if (node.kind !== "math") {
        return;
      }

      const request: MathRenderRequest = { node, signal: context.signal };

      try {
        const result = this.renderer.render(request);

        return isPromise(result)
          ? result.then(
              (rendered) => ({ ...rendered, origin: node.origin }),
              (cause: unknown) => this.renderFailure(cause, node, context),
            )
          : { ...result, origin: node.origin };
      } catch (cause) {
        return this.renderFailure(cause, node, context);
      }
    });
  }

  private renderFailure(cause: unknown, node: HtmlMathNode, context: HtmlPluginContext): undefined {
    if (this.mode === "strict") {
      throw cause;
    }

    context.diagnostics.add({
      severity: "warning",
      code: "mdx.plugin.math-render",
      message: `Could not render ${node.style} math: ${cause instanceof Error ? cause.message : String(cause)}`,
      span:
        node.origin === undefined
          ? undefined
          : { file: context.file, start: node.origin.start, end: node.origin.end },
    });
  }
}
