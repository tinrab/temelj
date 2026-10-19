import type { FlowContent, ListItemNode } from "../model.ts";
import type { BlockSyntax, ListItemSyntax } from "./block-syntax.ts";

export interface CachedMaterialization<TNode> {
  readonly node: TNode;
  readonly nodeCount: number;
  readonly depth: number;
  readonly references: readonly string[];
}

/**
 * Materialized nodes keyed by parser output identity, for materialization that
 * keeps references. Resolving references depends on the definitions, so a
 * resolving materialization does not use a cache.
 */
export interface MaterializeCache {
  readonly blocks: WeakMap<BlockSyntax, CachedMaterialization<FlowContent>>;
  readonly items: WeakMap<ListItemSyntax, CachedMaterialization<ListItemNode>>;
  /** A growing list's leading items, by the item they end with. */
  readonly lists: WeakMap<ListItemSyntax, CachedListPrefix>;
}

/** The materialized first `index + 1` items of a list: the first `length` of `nodes`. */
export interface CachedListPrefix {
  readonly index: number;
  readonly nodes: ListItemNode[];
  readonly length: number;
  /** `nodes` belongs to the open list, which extends it in place on the next append. */
  readonly live: boolean;
  readonly nodeCount: number;
  readonly depth: number;
  readonly references: readonly string[];
}

export function createMaterializeCache(): MaterializeCache {
  return { blocks: new WeakMap(), items: new WeakMap(), lists: new WeakMap() };
}
