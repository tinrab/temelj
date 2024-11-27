import { visit } from "unist-util-visit";

import type { HastElement, HastNode, PluginFactory } from "../../types.ts";

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
export function treeProcessorPlugin(
  { process }: TreeProcessorPluginOptions = { process: () => {} },
): PluginFactory {
  return async (tree: HastNode) => {
    const promises: Promise<void>[] = [];

    function visitElement(
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
    }

    visit(tree, "element", visitElement);
    await Promise.allSettled(promises);

    return tree;
  };
}
