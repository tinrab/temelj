export class TreeCursor<TRoot, TNode extends TRoot = TRoot> {
  public readonly depth: number;
  public readonly index?: number;
  public readonly node: TNode;
  public readonly parent?: TreeCursor<TRoot>;
  public readonly path: readonly number[];

  public constructor(node: TNode, parent?: TreeCursor<TRoot>, index?: number) {
    this.node = node;
    this.parent = parent;
    this.index = index;
    this.depth = parent === undefined ? 0 : parent.depth + 1;
    this.path = parent === undefined || index === undefined ? [] : [...parent.path, index];
  }

  public ancestors(): readonly TRoot[] {
    const result: TRoot[] = [];
    let cursor = this.parent;
    while (cursor !== undefined) {
      result.unshift(cursor.node);
      cursor = cursor.parent;
    }
    return result;
  }
}

export function* walkTree<TRoot>(
  root: TRoot,
  children: (node: TRoot) => readonly TRoot[],
): Iterable<TreeCursor<TRoot>> {
  yield* walkTreeNode(root, children);
}

export function* selectTree<TRoot extends { readonly kind: string }, TKind extends TRoot["kind"]>(
  root: TRoot,
  kind: TKind,
  children: (node: TRoot) => readonly TRoot[],
): Iterable<TreeCursor<TRoot, Extract<TRoot, { readonly kind: TKind }>>> {
  for (const cursor of walkTree(root, children)) {
    if (hasKind(cursor.node, kind)) {
      yield new TreeCursor(cursor.node, cursor.parent, cursor.index);
    }
  }
}

function hasKind<TRoot extends { readonly kind: string }, TKind extends TRoot["kind"]>(
  node: TRoot,
  kind: TKind,
): node is Extract<TRoot, { readonly kind: TKind }> {
  return node.kind === kind;
}

function* walkTreeNode<TRoot, TNode extends TRoot>(
  node: TNode,
  children: (node: TRoot) => readonly TRoot[],
  parent?: TreeCursor<TRoot>,
  index?: number,
): Iterable<TreeCursor<TRoot>> {
  const cursor = new TreeCursor<TRoot, TNode>(node, parent, index);
  yield cursor;
  const childNodes = children(node);
  for (let childIndex = 0; childIndex < childNodes.length; childIndex++) {
    yield* walkTreeNode(childNodes[childIndex], children, cursor, childIndex);
  }
}
