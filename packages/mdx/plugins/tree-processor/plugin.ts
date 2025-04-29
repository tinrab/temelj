import { visit } from "unist-util-visit";
import type { Plugin } from "unified";

import type { HastElement, HastNode } from "../../types.ts";

export type MdxTreeProcessor = (
  node: HastElement,
  index: number,
  parent: HastElement,
) => void | Promise<void>;

/**
 * Options for {@linkcode treeProcessorPlugin}.
 */
type TreeProcessorPluginOptions = {
  /** The processor. */
  process: MdxTreeProcessor;
};

/**
 * A plugin that allows to process MDX tree nodes.
 * It can be async or sync.
 */
export const treeProcessorPlugin: Plugin<
  [TreeProcessorPluginOptions?],
  HastNode,
  HastNode
> = ({ process } = { process: () => {} }) => {
  return async (tree) => {
    const promises: Promise<void>[] = [];

    visit(
      tree,
      "element",
      function visitor(
        node: HastElement,
        index: number,
        parent: HastElement,
      ): void {
        const p = process(node, index, parent);
        if (
          p instanceof Promise ||
          Object.prototype.toString.call(p) === "[object Promise]"
        ) {
          promises.push(p as Promise<void>);
        }
      },
    );

    await Promise.allSettled(promises);

    return tree;
  };
};
