import type { HtmlKind, HtmlNode, HtmlNodeForKind, HtmlRootNode } from "./html.ts";
import type {
  DirectiveLabelNode,
  DocumentNode,
  FlowContent,
  MdxKind,
  MdxNode,
  MdxNodeForKind,
  PhrasingContent,
} from "./model.ts";

import { htmlChildren } from "./html.ts";
import { isFlowContent, isPhrasingContent, mdxChildren } from "./model.ts";
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
 * A node that may replace `TNode`: any phrasing node for phrasing content, any
 * flow node for flow content, and the same kind otherwise.
 */
export type MdxReplacement<TNode extends MdxNode> = TNode extends PhrasingContent
  ? PhrasingContent
  : TNode extends FlowContent
    ? FlowContent
    : TNode;

/**
 * A rewrite handler runs before the node's children are rewritten. Returning
 * `undefined` keeps the node, a node of the same content category replaces it,
 * and `null` removes it from its parent.
 */
export type MdxRewriteHandlers = {
  readonly [TKind in MdxKind]?: (
    cursor: TreeCursor<MdxNode, MdxNodeForKind<TKind>>,
  ) => MdxReplacement<MdxNodeForKind<TKind>> | null | undefined;
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

function rewriteMdxNode(
  node: MdxNode,
  parent: TreeCursor<MdxNode> | undefined,
  index: number | undefined,
  handlers: MdxRewriteHandlers,
): MdxNode | null {
  const replacement = invokeMdxHandler(handlers, node.kind, new TreeCursor(node, parent, index));

  if (replacement === null) {
    return null;
  }

  if (replacement !== undefined && !replaceable(node, replacement)) {
    throw new TypeError(`A ${node.kind} rewrite handler returned a ${replacement.kind} node`);
  }

  const current = replacement ?? node;
  const cursor = new TreeCursor<MdxNode>(current, parent, index);

  switch (current.kind) {
    case "textDirective":
    case "leafDirective": {
      const label = rewriteLabel(current.label, cursor, handlers);

      return label === current.label ? current : { ...current, label };
    }

    case "containerDirective": {
      const offset = current.label === undefined ? 0 : 1;
      const body = rewriteParent(current, cursor, offset, handlers);
      const label = rewriteLabel(current.label, cursor, handlers);

      return label === body.label ? body : { ...body, label };
    }

    default:
      return "children" in current ? rewriteParent(current, cursor, 0, handlers) : current;
  }
}

type MdxParentNode = Extract<MdxNode, { readonly children: readonly MdxNode[] }>;

function rewriteParent<TNode extends MdxParentNode>(
  node: TNode,
  cursor: TreeCursor<MdxNode>,
  offset: number,
  handlers: MdxRewriteHandlers,
): TNode {
  const children = rewriteChildren<MdxNode>(node.children, (child, childIndex) =>
    rewriteMdxNode(child, cursor, childIndex + offset, handlers),
  );

  if (children === node.children) {
    return node;
  }

  if (!fitsParent(node, children)) {
    throw new TypeError(`A rewrite produced children that a ${node.kind} node cannot contain`);
  }

  return { ...node, children };
}

/** Rewrite handlers keep content categories, so this holds unless a handler bypassed the types. */
function fitsParent<TNode extends MdxParentNode>(
  parent: TNode,
  children: readonly MdxNode[],
): children is TNode["children"] {
  return children.every((child) => acceptsChild(parent, child));
}

function acceptsChild(parent: MdxParentNode, child: MdxNode): boolean {
  switch (parent.kind) {
    case "list":
      return child.kind === "listItem";
    case "table":
      return child.kind === "tableRow";
    case "tableRow":
      return child.kind === "tableCell";
    case "document":
    case "blockquote":
    case "listItem":
    case "footnoteDefinition":
    case "containerDirective":
    case "jsxFlowElement":
      return isFlowContent(child);
    case "emphasis":
    case "strong":
    case "delete":
    case "link":
    case "linkReference":
    case "directiveLabel":
    case "jsxTextElement":
    case "paragraph":
    case "heading":
    case "tableCell":
      return isPhrasingContent(child);
    default: {
      const exhaustive: never = parent;

      return exhaustive;
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
): MdxNode | null | undefined {
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

function rewriteLabel(
  label: DirectiveLabelNode | undefined,
  parent: TreeCursor<MdxNode>,
  handlers: MdxRewriteHandlers,
): DirectiveLabelNode | undefined {
  const result = label === undefined ? undefined : rewriteMdxNode(label, parent, 0, handlers);

  return result?.kind === "directiveLabel" ? result : undefined;
}

/** Phrasing and flow nodes may change kind within their category; other nodes keep their kind. */
function replaceable(node: MdxNode, replacement: MdxNode): boolean {
  if (isPhrasingContent(node)) {
    return isPhrasingContent(replacement);
  }

  if (isFlowContent(node)) {
    return isFlowContent(replacement);
  }

  return replacement.kind === node.kind;
}
