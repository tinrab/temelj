/**
 * Traverses a tree structure using breadth-first search.
 *
 * @param root The root node of the tree.
 * @param getChildren A function that returns the children of a node.
 * @returns A generator that yields nodes in BFS order.
 *
 * @example
 * ```ts
 * const tree = {
 *   value: 1,
 *   children: [
 *     { value: 2, children: [] },
 *     { value: 3, children: [{ value: 4, children: [] }] }
 *   ]
 * };
 * for (const node of traverseBfs(tree, n => n.children)) {
 *   console.log(node.value); // 1, 2, 3, 4
 * }
 * ```
 */
export function* traverseBfs<T>(
  root: T,
  getChildren: (node: T) => Iterable<T>,
): Generator<T> {
  const queue: T[] = [root];

  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) {
      continue;
    }
    yield node;

    for (const child of getChildren(node)) {
      queue.push(child);
    }
  }
}

/**
 * Traverses a tree structure using depth-first search (pre-order).
 *
 * @param root The root node of the tree.
 * @param getChildren A function that returns the children of a node.
 * @returns A generator that yields nodes in DFS pre-order.
 *
 * @example
 * ```ts
 * const tree = {
 *   value: 1,
 *   children: [
 *     { value: 2, children: [] },
 *     { value: 3, children: [{ value: 4, children: [] }] }
 *   ]
 * };
 * for (const node of traverseDfs(tree, n => n.children)) {
 *   console.log(node.value); // 1, 2, 3, 4
 * }
 * ```
 */
export function* traverseDfs<T>(
  root: T,
  getChildren: (node: T) => Iterable<T>,
): Generator<T> {
  yield root;

  for (const child of getChildren(root)) {
    yield* traverseDfs(child, getChildren);
  }
}
