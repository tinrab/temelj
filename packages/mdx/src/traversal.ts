import type { HtmlKind, HtmlNode, HtmlNodeForKind, HtmlRootNode } from "./html.ts";
import type { DocumentNode, MdxKind, MdxNode, MdxNodeForKind } from "./model.ts";

import { htmlChildren } from "./html.ts";
import { mdxChildren } from "./model.ts";
import { selectTree, TreeCursor, walkTree } from "./tree.ts";

export { TreeCursor } from "./tree.ts";

export function* walkMdx(root: MdxNode): Iterable<TreeCursor<MdxNode>> {
  yield* walkTree(root, mdxChildren);
}

export function* selectMdx<TKind extends MdxKind>(
  root: MdxNode,
  kind: TKind,
): Iterable<TreeCursor<MdxNode, MdxNodeForKind<TKind>>> {
  yield* selectTree(root, kind, mdxChildren);
}

export function* walkHtml(root: HtmlNode): Iterable<TreeCursor<HtmlNode>> {
  yield* walkTree(root, htmlChildren);
}

export function* selectHtml<TKind extends HtmlKind>(
  root: HtmlNode,
  kind: TKind,
): Iterable<TreeCursor<HtmlNode, HtmlNodeForKind<TKind>>> {
  yield* selectTree(root, kind, htmlChildren);
}

/**
 * A rewrite handler runs before the node's children are rewritten. Returning
 * `undefined` keeps the node, a node of the same kind replaces it, and `null`
 * removes it from its parent.
 */
type RewriteHandler<TRoot, TNode extends TRoot> = (
  cursor: TreeCursor<TRoot, TNode>,
) => TNode | null | undefined;

export type MdxRewriteHandlers = {
  readonly [TKind in MdxKind]?: RewriteHandler<MdxNode, MdxNodeForKind<TKind>>;
};

/** HTML handlers may replace a node with any node kind, because every parent accepts all kinds. */
export type HtmlRewriteHandlers = {
  readonly [TKind in HtmlKind]?: (
    cursor: TreeCursor<HtmlNode, HtmlNodeForKind<TKind>>,
  ) => HtmlNode | null | undefined;
};

export function rewriteMdx(document: DocumentNode, handlers: MdxRewriteHandlers): DocumentNode {
  const result = rewriteMdxNode(document, undefined, undefined, handlers);

  return result?.kind === "document" ? result : { ...document, children: [] };
}

export function rewriteHtml(root: HtmlRootNode, handlers: HtmlRewriteHandlers): HtmlRootNode {
  const result = rewriteHtmlNode(root, undefined, undefined, handlers);

  if (result === null) {
    return { ...root, children: [] };
  }

  return result.kind === "root" ? result : { ...root, children: [result] };
}

function rewriteMdxNode<TNode extends MdxNode>(
  node: TNode,
  parent: TreeCursor<MdxNode> | undefined,
  index: number | undefined,
  handlers: MdxRewriteHandlers,
): TNode | null {
  const replacement = invokeMdxHandler(handlers, node.kind, new TreeCursor(node, parent, index));

  if (replacement === null) {
    return null;
  }

  if (replacement !== undefined && !sameKind(node, replacement)) {
    throw new TypeError(`A ${node.kind} rewrite handler returned a ${replacement.kind} node`);
  }

  const current = replacement ?? node;
  const cursor = new TreeCursor<MdxNode>(current, parent, index);

  switch (current.kind) {
    case "textDirective":
    case "leafDirective": {
      const label =
        current.label === undefined
          ? undefined
          : rewriteMdxNode(current.label, cursor, 0, handlers);

      return label === current.label ? current : { ...current, label: label ?? undefined };
    }

    case "containerDirective": {
      const offset = current.label === undefined ? 0 : 1;

      const label =
        current.label === undefined
          ? undefined
          : rewriteMdxNode(current.label, cursor, 0, handlers);

      const children = rewriteChildren(current.children, (child, childIndex) =>
        rewriteMdxNode(child, cursor, childIndex + offset, handlers),
      );

      return label === current.label && children === current.children
        ? current
        : { ...current, label: label ?? undefined, children };
    }

    default: {
      if (!("children" in current)) {
        return current;
      }

      const children = rewriteChildren<MdxNode>(current.children, (child, childIndex) =>
        rewriteMdxNode(child, cursor, childIndex, handlers),
      );

      // SAFETY: rewritten children keep their kinds, so they stay valid for this parent.
      return children === current.children ? current : ({ ...current, children } as TNode);
    }
  }
}

function rewriteHtmlNode(
  node: HtmlNode,
  parent: TreeCursor<HtmlNode> | undefined,
  index: number | undefined,
  handlers: HtmlRewriteHandlers,
): HtmlNode | null {
  const replacement = invokeHtmlHandler(handlers, node.kind, new TreeCursor(node, parent, index));

  if (replacement === null) {
    return null;
  }

  const current = replacement ?? node;

  if (!("children" in current)) {
    return current;
  }

  const cursor = new TreeCursor<HtmlNode>(current, parent, index);

  const children = rewriteChildren<HtmlNode>(current.children, (child, childIndex) =>
    rewriteHtmlNode(child, cursor, childIndex, handlers),
  );

  return children === current.children ? current : { ...current, children };
}

/** Returns the original array when every child is kept unchanged. */
function rewriteChildren<TChild>(
  children: readonly TChild[],
  rewrite: (child: TChild, index: number) => TChild | null,
): readonly TChild[] {
  let result: TChild[] | undefined;

  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    const next = rewrite(child, index);

    if (result === undefined && next !== child) {
      result = children.slice(0, index);
    }

    if (result !== undefined && next !== null) {
      result.push(next);
    }
  }

  return result ?? children;
}

/** Calls the handler for one kind. The mapped handler type correlates kind and node. */
function invokeMdxHandler<TKind extends MdxKind>(
  handlers: MdxRewriteHandlers,
  kind: TKind,
  cursor: TreeCursor<MdxNode, MdxNodeForKind<TKind>>,
): MdxNodeForKind<TKind> | null | undefined {
  const handler: MdxRewriteHandlers[TKind] = handlers[kind];

  return handler?.(cursor);
}

function invokeHtmlHandler<TKind extends HtmlKind>(
  handlers: HtmlRewriteHandlers,
  kind: TKind,
  cursor: TreeCursor<HtmlNode, HtmlNodeForKind<TKind>>,
): HtmlNode | null | undefined {
  const handler: HtmlRewriteHandlers[TKind] = handlers[kind];

  return handler?.(cursor);
}

/** Nodes of one discriminated kind share a type. */
function sameKind<TNode extends MdxNode>(node: TNode, replacement: MdxNode): replacement is TNode {
  return replacement.kind === node.kind;
}
