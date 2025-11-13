import { remove } from "unist-util-remove";
import type { Plugin } from "unified";

import type { HastNode } from "../types";

/**
 * A remark plugin which removes all import and export statements.
 */
export const removeImportsExportsPlugin: Plugin<
  [unknown],
  HastNode,
  HastNode
> = () => {
  return (tree: HastNode) => {
    remove(tree, "mdxjsEsm");
    return tree;
  };
};
