import type { HtmlDocumentNode } from "../html.ts";
import type { HtmlTransformContext } from "../plugin.ts";

import { ConfigurationError } from "../errors.ts";
import { headingDepthForTag } from "../heading.ts";
import { HtmlTransformPlugin } from "../plugin.ts";

export interface LowerHeadingPluginOptions {
  /** Number of levels by which to lower each rendered heading. */
  readonly offset?: number;
}

/** Lowers rendered HTML headings without changing the authored MDX heading depth. */
export class LowerHeadingPlugin extends HtmlTransformPlugin {
  public readonly name = "lower-heading";
  private readonly offset: number;

  public constructor(options: LowerHeadingPluginOptions = {}) {
    super();
    const offset = options.offset ?? 1;
    if (!Number.isSafeInteger(offset) || offset < 1) {
      ConfigurationError.invalidPluginIntegerOption("lower-heading", "offset", offset, 1);
    }
    this.offset = offset;
  }

  public transform(context: HtmlTransformContext): HtmlDocumentNode {
    return context.rewrite({
      element: ({ node }) => {
        const depth = headingDepthForTag(node.tagName);
        if (depth === undefined) {
          return node;
        }
        const loweredDepth = Math.min(depth + this.offset, 6);
        return loweredDepth === depth ? node : node.with({ tagName: `h${loweredDepth}` });
      },
    });
  }
}
