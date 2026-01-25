import GithubSlugger from "github-slugger";
import { toString as hastToString } from "hast-util-to-string";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

import type { HastElement, HastNode } from "../../types";

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
export const headingIdPlugin: Plugin<
  [HeadingIdPluginOptions?],
  HastNode,
  HastNode
> = ({ prefix } = {}) => {
  const slugger = new GithubSlugger();
  return (tree) => {
    slugger.reset();
    visit(
      tree,
      "element",
      function visitor(
        node: HastElement,
        index: number,
        parent: HastElement,
      ): void {
        if (!parent || index === null || !node.tagName.startsWith("h")) return;
        const id = (prefix ?? "") + slugger.slug(hastToString(node));
        node.properties.id = id;
      },
    );
    return tree;
  };
};
