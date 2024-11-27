import { remove } from "unist-util-remove";

import type { HastNode, PluginFactory } from "../types.ts";

/**
 * A remark plugin which removes all import and export statements.
 */
export function removeImportsExportsPlugin(): PluginFactory {
  return (tree: HastNode) => {
    remove(tree, "mdxjsEsm");
    return tree;
  };
}
