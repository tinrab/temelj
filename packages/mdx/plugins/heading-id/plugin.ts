import GithubSlugger from "github-slugger";
import { toString as hastToString } from "hast-util-to-string";
import { visit } from "unist-util-visit";

import type { HastElement, HastNode, PluginFactory } from "../../types.ts";

/**
 * Options for {@linkcode headingIdPlugin}.
 */
export interface HeadingIdPluginOptions {
  /** Prefix for title slugs. */
  prefix?: string;
}

/**
 * A rehype plugin that adds IDs to heading tags.
 */
export function headingIdPlugin({
  prefix,
}: HeadingIdPluginOptions = {}): PluginFactory {
  const slugger = new GithubSlugger();

  return (tree: HastNode) => {
    slugger.reset();

    visit(tree, "element", visitor);

    function visitor(
      node: HastElement,
      index: number,
      parent: HastElement,
    ): void {
      if (!parent || index === null || !node.tagName.startsWith("h")) {
        return;
      }

      const id = (prefix ?? "") + slugger.slug(hastToString(node));
      node.properties.id = id;
    }

    return tree;
  };
}
