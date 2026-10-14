import type { HtmlRootNode } from "../html.ts";
import type { HtmlPlugin, HtmlPluginContext } from "../plugin.ts";

import { ConfigurationError } from "../errors.ts";
import { headingDepthForTag } from "../heading.ts";

export interface LowerHeadingPluginOptions {
  /** Number of levels by which to lower each rendered heading. */
  readonly offset?: number;
}

/** Lowers rendered HTML headings without changing the authored MDX heading depth. */
export class LowerHeadingPlugin implements HtmlPlugin {
  public readonly name = "lower-heading";
  private readonly offset: number;

  public constructor(options: LowerHeadingPluginOptions = {}) {
    const offset = options.offset ?? 1;

    if (!Number.isSafeInteger(offset) || offset < 1) {
      ConfigurationError.invalidPluginIntegerOption("lower-heading", "offset", offset, 1);
    }

    this.offset = offset;
  }

  public transform(context: HtmlPluginContext): HtmlRootNode {
    return context.rewrite({
      element: ({ node }) => {
        const depth = headingDepthForTag(node.tagName);

        if (depth === undefined) {
          return;
        }

        const lowered = Math.min(depth + this.offset, 6);

        return lowered === depth ? undefined : { ...node, tagName: `h${lowered}` };
      },
    });
  }
}
