import {
  HtmlCommentNode,
  HtmlDoctypeNode,
  HtmlDocumentNode,
  HtmlElementNode,
  HtmlFragmentNode,
  HtmlJsxNode,
  HtmlNode,
  HtmlRawNode,
  HtmlTextNode,
  type HtmlKind,
} from "./html.ts";
import {
  BlockQuoteNode,
  CodeBlockNode,
  ContainerDirectiveNode,
  DefinitionNode,
  DeleteNode,
  DisplayMathNode,
  DirectiveLabelNode,
  EmphasisNode,
  FootnoteDefinitionNode,
  FootnoteReferenceNode,
  FrontmatterNode,
  HardBreakNode,
  HeadingNode,
  ImageNode,
  ImageReferenceNode,
  InlineCodeNode,
  InlineMathNode,
  LinkNode,
  LinkReferenceNode,
  LeafDirectiveNode,
  ListNode,
  ListItemNode,
  BlockExpressionNode,
  DocumentNode,
  EsmNode,
  InlineExpressionNode,
  JsxAttributeNode,
  JsxAttributeValueExpressionNode,
  JsxFlowElementNode,
  JsxSpreadAttributeNode,
  JsxTextElementNode,
  ParagraphNode,
  RawHtmlBlockNode,
  RawHtmlInlineNode,
  StrongNode,
  TableNode,
  TableCellNode,
  TableRowNode,
  TextNode,
  TextDirectiveNode,
  ThematicBreakNode,
  type FlowContent,
  type MdxNode,
  type PhrasingContent,
} from "./model.ts";
import { selectTree, TreeCursor, walkTree } from "./tree.ts";

export { TreeCursor } from "./tree.ts";

export function* walkMdx(root: MdxNode): Iterable<TreeCursor<MdxNode>> {
  yield* walkTree(root, (node) => node.children);
}

export function* selectMdx<TKind extends MdxNode["kind"]>(
  root: MdxNode,
  kind: TKind,
): Iterable<TreeCursor<MdxNode, Extract<MdxNode, { readonly kind: TKind }>>> {
  yield* selectTree(root, kind, (node) => node.children);
}

type RewriteHandler<TNode extends MdxNode> = (
  cursor: TreeCursor<MdxNode, TNode>,
) => TNode | undefined;
type CoreFlowContent = Exclude<FlowContent, BlockExpressionNode | EsmNode | JsxFlowElementNode>;

export interface MdxRewriteHandlers {
  readonly blockquote?: RewriteHandler<BlockQuoteNode>;
  readonly codeBlock?: RewriteHandler<CodeBlockNode>;
  readonly definition?: RewriteHandler<DefinitionNode>;
  readonly delete?: RewriteHandler<DeleteNode>;
  readonly displayMath?: RewriteHandler<DisplayMathNode>;
  readonly containerDirective?: RewriteHandler<ContainerDirectiveNode>;
  readonly directiveLabel?: RewriteHandler<DirectiveLabelNode>;
  readonly emphasis?: RewriteHandler<EmphasisNode>;
  readonly footnoteDefinition?: RewriteHandler<FootnoteDefinitionNode>;
  readonly footnoteReference?: RewriteHandler<FootnoteReferenceNode>;
  readonly frontmatter?: RewriteHandler<FrontmatterNode>;
  readonly hardBreak?: RewriteHandler<HardBreakNode>;
  readonly heading?: RewriteHandler<HeadingNode>;
  readonly image?: RewriteHandler<ImageNode>;
  readonly imageReference?: RewriteHandler<ImageReferenceNode>;
  readonly inlineCode?: RewriteHandler<InlineCodeNode>;
  readonly inlineMath?: RewriteHandler<InlineMathNode>;
  readonly link?: RewriteHandler<LinkNode>;
  readonly linkReference?: RewriteHandler<LinkReferenceNode>;
  readonly leafDirective?: RewriteHandler<LeafDirectiveNode>;
  readonly list?: RewriteHandler<ListNode>;
  readonly listItem?: RewriteHandler<ListItemNode>;
  readonly blockExpression?: RewriteHandler<BlockExpressionNode>;
  readonly document?: RewriteHandler<DocumentNode>;
  readonly esm?: RewriteHandler<EsmNode>;
  readonly inlineExpression?: RewriteHandler<InlineExpressionNode>;
  readonly jsxAttribute?: RewriteHandler<JsxAttributeNode>;
  readonly jsxAttributeValueExpression?: RewriteHandler<JsxAttributeValueExpressionNode>;
  readonly jsxFlowElement?: RewriteHandler<JsxFlowElementNode>;
  readonly jsxSpreadAttribute?: RewriteHandler<JsxSpreadAttributeNode>;
  readonly jsxTextElement?: RewriteHandler<JsxTextElementNode>;
  readonly paragraph?: RewriteHandler<ParagraphNode>;
  readonly rawHtmlBlock?: RewriteHandler<RawHtmlBlockNode>;
  readonly rawHtmlInline?: RewriteHandler<RawHtmlInlineNode>;
  readonly strong?: RewriteHandler<StrongNode>;
  readonly table?: RewriteHandler<TableNode>;
  readonly tableCell?: RewriteHandler<TableCellNode>;
  readonly tableRow?: RewriteHandler<TableRowNode>;
  readonly text?: RewriteHandler<TextNode>;
  readonly textDirective?: RewriteHandler<TextDirectiveNode>;
  readonly thematicBreak?: RewriteHandler<ThematicBreakNode>;
}

export function rewriteMdx(document: DocumentNode, handlers: MdxRewriteHandlers): DocumentNode {
  const replacement = handlers.document?.(new TreeCursor(document)) ?? document;
  const cursor = new TreeCursor<MdxNode, DocumentNode>(replacement);
  const children = replacement.children.map((child, index) =>
    rewriteFlow(child, cursor, index, handlers),
  );
  return replacement.with({ children });
}

function rewritePhrasing(
  node: PhrasingContent,
  parent: TreeCursor<MdxNode>,
  index: number,
  handlers: MdxRewriteHandlers,
): PhrasingContent {
  switch (node.kind) {
    case "text":
      return handlers.text?.(new TreeCursor(node, parent, index)) ?? node;
    case "emphasis": {
      const replacement = handlers.emphasis?.(new TreeCursor(node, parent, index)) ?? node;
      const cursor = new TreeCursor(replacement, parent, index);
      return replacement.with({
        children: replacement.children.map((child, childIndex) =>
          rewritePhrasing(child, cursor, childIndex, handlers),
        ),
      });
    }
    case "strong": {
      const replacement = handlers.strong?.(new TreeCursor(node, parent, index)) ?? node;
      const cursor = new TreeCursor(replacement, parent, index);
      return replacement.with({
        children: replacement.children.map((child, childIndex) =>
          rewritePhrasing(child, cursor, childIndex, handlers),
        ),
      });
    }
    case "delete": {
      const replacement = handlers.delete?.(new TreeCursor(node, parent, index)) ?? node;
      const cursor = new TreeCursor(replacement, parent, index);
      return replacement.with({
        children: replacement.children.map((child, childIndex) =>
          rewritePhrasing(child, cursor, childIndex, handlers),
        ),
      });
    }
    case "textDirective": {
      const replacement = handlers.textDirective?.(new TreeCursor(node, parent, index)) ?? node;
      const cursor = new TreeCursor(replacement, parent, index);
      return replacement.with({
        label:
          replacement.label === undefined
            ? null
            : rewriteDirectiveLabel(replacement.label, cursor, 0, handlers),
      });
    }
    case "inlineCode":
      return handlers.inlineCode?.(new TreeCursor(node, parent, index)) ?? node;
    case "inlineMath":
      return handlers.inlineMath?.(new TreeCursor(node, parent, index)) ?? node;
    case "hardBreak":
      return handlers.hardBreak?.(new TreeCursor(node, parent, index)) ?? node;
    case "link": {
      const replacement = handlers.link?.(new TreeCursor(node, parent, index)) ?? node;
      const cursor = new TreeCursor(replacement, parent, index);
      return replacement.with({
        children: replacement.children.map((child, childIndex) =>
          rewritePhrasing(child, cursor, childIndex, handlers),
        ),
      });
    }
    case "image":
      return handlers.image?.(new TreeCursor(node, parent, index)) ?? node;
    case "linkReference": {
      const replacement = handlers.linkReference?.(new TreeCursor(node, parent, index)) ?? node;
      const cursor = new TreeCursor(replacement, parent, index);
      return replacement.with({
        children: replacement.children.map((child, childIndex) =>
          rewritePhrasing(child, cursor, childIndex, handlers),
        ),
      });
    }
    case "imageReference":
      return handlers.imageReference?.(new TreeCursor(node, parent, index)) ?? node;
    case "footnoteReference":
      return handlers.footnoteReference?.(new TreeCursor(node, parent, index)) ?? node;
    case "rawHtmlInline":
      return handlers.rawHtmlInline?.(new TreeCursor(node, parent, index)) ?? node;
    case "inlineExpression":
      return handlers.inlineExpression?.(new TreeCursor(node, parent, index)) ?? node;
    case "jsxTextElement": {
      const replacement = handlers.jsxTextElement?.(new TreeCursor(node, parent, index)) ?? node;
      const cursor = new TreeCursor(replacement, parent, index);
      return replacement.with({
        attributes: rewriteJsxAttributes(replacement.attributes, cursor, handlers),
        children: replacement.children.map((child, childIndex) =>
          rewritePhrasing(child, cursor, childIndex, handlers),
        ),
      });
    }
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

function rewriteCoreFlow(
  node: CoreFlowContent,
  parent: TreeCursor<MdxNode>,
  index: number,
  handlers: MdxRewriteHandlers,
): CoreFlowContent {
  switch (node.kind) {
    case "paragraph": {
      const replacement = handlers.paragraph?.(new TreeCursor(node, parent, index)) ?? node;
      const cursor = new TreeCursor(replacement, parent, index);
      return replacement.with({
        children: replacement.children.map((child, childIndex) =>
          rewritePhrasing(child, cursor, childIndex, handlers),
        ),
      });
    }
    case "heading": {
      const replacement = handlers.heading?.(new TreeCursor(node, parent, index)) ?? node;
      const cursor = new TreeCursor(replacement, parent, index);
      return replacement.with({
        children: replacement.children.map((child, childIndex) =>
          rewritePhrasing(child, cursor, childIndex, handlers),
        ),
      });
    }
    case "codeBlock":
      return handlers.codeBlock?.(new TreeCursor(node, parent, index)) ?? node;
    case "displayMath":
      return handlers.displayMath?.(new TreeCursor(node, parent, index)) ?? node;
    case "thematicBreak":
      return handlers.thematicBreak?.(new TreeCursor(node, parent, index)) ?? node;
    case "blockquote": {
      const replacement = handlers.blockquote?.(new TreeCursor(node, parent, index)) ?? node;
      const cursor = new TreeCursor(replacement, parent, index);
      return replacement.with({
        children: replacement.children.map((child, childIndex) =>
          rewriteFlow(child, cursor, childIndex, handlers),
        ),
      });
    }
    case "list":
      return rewriteList(node, parent, index, handlers);
    case "table":
      return rewriteTable(node, parent, index, handlers);
    case "definition":
      return handlers.definition?.(new TreeCursor(node, parent, index)) ?? node;
    case "footnoteDefinition": {
      const replacement =
        handlers.footnoteDefinition?.(new TreeCursor(node, parent, index)) ?? node;
      const cursor = new TreeCursor(replacement, parent, index);
      return replacement.with({
        children: replacement.children.map((child, childIndex) =>
          rewriteFlow(child, cursor, childIndex, handlers),
        ),
      });
    }
    case "frontmatter":
      return handlers.frontmatter?.(new TreeCursor(node, parent, index)) ?? node;
    case "leafDirective": {
      const replacement = handlers.leafDirective?.(new TreeCursor(node, parent, index)) ?? node;
      const cursor = new TreeCursor(replacement, parent, index);
      return replacement.with({
        label:
          replacement.label === undefined
            ? null
            : rewriteDirectiveLabel(replacement.label, cursor, 0, handlers),
      });
    }
    case "containerDirective": {
      const replacement =
        handlers.containerDirective?.(new TreeCursor(node, parent, index)) ?? node;
      const cursor = new TreeCursor(replacement, parent, index);
      const label =
        replacement.label === undefined
          ? undefined
          : rewriteDirectiveLabel(replacement.label, cursor, 0, handlers);
      const offset = label === undefined ? 0 : 1;
      return replacement.with({
        label: label ?? null,
        body: replacement.body.map((child, childIndex) =>
          rewriteFlow(child, cursor, childIndex + offset, handlers),
        ),
      });
    }
    case "rawHtmlBlock":
      return handlers.rawHtmlBlock?.(new TreeCursor(node, parent, index)) ?? node;
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

function rewriteDirectiveLabel(
  node: DirectiveLabelNode,
  parent: TreeCursor<MdxNode>,
  index: number,
  handlers: MdxRewriteHandlers,
): DirectiveLabelNode {
  const replacement = handlers.directiveLabel?.(new TreeCursor(node, parent, index)) ?? node;
  const cursor = new TreeCursor(replacement, parent, index);
  return replacement.with({
    children: replacement.children.map((child, childIndex) =>
      rewritePhrasing(child, cursor, childIndex, handlers),
    ),
  });
}

function rewriteTable(
  node: TableNode,
  parent: TreeCursor<MdxNode>,
  index: number,
  handlers: MdxRewriteHandlers,
): TableNode {
  const replacement = handlers.table?.(new TreeCursor(node, parent, index)) ?? node;
  const cursor = new TreeCursor(replacement, parent, index);
  return replacement.with({
    children: replacement.children.map((row, rowIndex) =>
      rewriteTableRow(row, cursor, rowIndex, handlers),
    ),
  });
}

function rewriteTableRow(
  node: TableRowNode,
  parent: TreeCursor<MdxNode>,
  index: number,
  handlers: MdxRewriteHandlers,
): TableRowNode {
  const replacement = handlers.tableRow?.(new TreeCursor(node, parent, index)) ?? node;
  const cursor = new TreeCursor(replacement, parent, index);
  return replacement.with({
    children: replacement.children.map((cell, cellIndex) =>
      rewriteTableCell(cell, cursor, cellIndex, handlers),
    ),
  });
}

function rewriteTableCell(
  node: TableCellNode,
  parent: TreeCursor<MdxNode>,
  index: number,
  handlers: MdxRewriteHandlers,
): TableCellNode {
  const replacement = handlers.tableCell?.(new TreeCursor(node, parent, index)) ?? node;
  const cursor = new TreeCursor(replacement, parent, index);
  return replacement.with({
    children: replacement.children.map((child, childIndex) =>
      rewritePhrasing(child, cursor, childIndex, handlers),
    ),
  });
}

function rewriteFlow(
  node: FlowContent,
  parent: TreeCursor<MdxNode>,
  index: number,
  handlers: MdxRewriteHandlers,
): FlowContent {
  switch (node.kind) {
    case "blockExpression":
      return handlers.blockExpression?.(new TreeCursor(node, parent, index)) ?? node;
    case "esm":
      return handlers.esm?.(new TreeCursor(node, parent, index)) ?? node;
    case "jsxFlowElement": {
      const replacement = handlers.jsxFlowElement?.(new TreeCursor(node, parent, index)) ?? node;
      const cursor = new TreeCursor(replacement, parent, index);
      return replacement.with({
        attributes: rewriteJsxAttributes(replacement.attributes, cursor, handlers),
        children: replacement.children.map((child, childIndex) =>
          rewriteFlow(child, cursor, childIndex, handlers),
        ),
      });
    }
    default:
      return rewriteCoreFlow(node, parent, index, handlers);
  }
}

function rewriteJsxAttributes(
  attributes: readonly (JsxAttributeNode | JsxSpreadAttributeNode)[],
  parent: TreeCursor<MdxNode>,
  handlers: MdxRewriteHandlers,
): readonly (JsxAttributeNode | JsxSpreadAttributeNode)[] {
  return attributes.map((attribute, index) => {
    if (attribute instanceof JsxSpreadAttributeNode) {
      return handlers.jsxSpreadAttribute?.(new TreeCursor(attribute, parent, index)) ?? attribute;
    }
    const replacement =
      handlers.jsxAttribute?.(new TreeCursor(attribute, parent, index)) ?? attribute;
    if (!(replacement.value instanceof JsxAttributeValueExpressionNode)) {
      return replacement;
    }
    const value =
      handlers.jsxAttributeValueExpression?.(
        new TreeCursor(replacement.value, new TreeCursor(replacement, parent, index), 0),
      ) ?? replacement.value;
    return replacement.with({ value });
  });
}

function rewriteList(
  node: ListNode,
  parent: TreeCursor<MdxNode>,
  index: number,
  handlers: MdxRewriteHandlers,
): ListNode {
  const replacement = handlers.list?.(new TreeCursor(node, parent, index)) ?? node;
  const cursor = new TreeCursor(replacement, parent, index);
  const items = replacement.items.map((item, itemIndex) => {
    const itemReplacement = handlers.listItem?.(new TreeCursor(item, cursor, itemIndex)) ?? item;
    const itemCursor = new TreeCursor(itemReplacement, cursor, itemIndex);
    return itemReplacement.with({
      children: itemReplacement.children.map((child, childIndex) =>
        rewriteFlow(child, itemCursor, childIndex, handlers),
      ),
    });
  });
  return replacement.with({ items });
}

export interface HtmlRewriteHandlers {
  readonly comment?: (cursor: TreeCursor<HtmlNode, HtmlCommentNode>) => HtmlCommentNode | undefined;
  readonly doctype?: (cursor: TreeCursor<HtmlNode, HtmlDoctypeNode>) => HtmlDoctypeNode | undefined;
  readonly document?: (
    cursor: TreeCursor<HtmlNode, HtmlDocumentNode>,
  ) => HtmlDocumentNode | undefined;
  readonly element?: (cursor: TreeCursor<HtmlNode, HtmlElementNode>) => HtmlElementNode | undefined;
  readonly fragment?: (
    cursor: TreeCursor<HtmlNode, HtmlFragmentNode>,
  ) => HtmlFragmentNode | undefined;
  readonly jsx?: (cursor: TreeCursor<HtmlNode, HtmlJsxNode>) => HtmlJsxNode | undefined;
  readonly raw?: (cursor: TreeCursor<HtmlNode, HtmlRawNode>) => HtmlRawNode | undefined;
  readonly text?: (cursor: TreeCursor<HtmlNode, HtmlTextNode>) => HtmlTextNode | undefined;
}

export function* walkHtml(root: HtmlNode): Iterable<TreeCursor<HtmlNode>> {
  yield* walkTree(root, htmlChildren);
}

export type HtmlNodeForKind<TKind extends HtmlKind> = Extract<HtmlNode, { readonly kind: TKind }>;

export function* selectHtml<TKind extends HtmlKind>(
  root: HtmlNode,
  kind: TKind,
): Iterable<TreeCursor<HtmlNode, HtmlNodeForKind<TKind>>> {
  yield* selectTree(root, kind, htmlChildren);
}

export function rewriteHtml(
  document: HtmlDocumentNode,
  handlers: HtmlRewriteHandlers,
): HtmlDocumentNode {
  return rewriteHtmlDocument(document, undefined, undefined, handlers);
}

function rewriteHtmlNode(
  node: HtmlNode,
  parent: TreeCursor<HtmlNode>,
  index: number,
  handlers: HtmlRewriteHandlers,
): HtmlNode {
  if (node instanceof HtmlJsxNode) {
    return handlers.jsx?.(new TreeCursor(node, parent, index)) ?? node;
  }
  if (node instanceof HtmlTextNode) {
    return handlers.text?.(new TreeCursor(node, parent, index)) ?? node;
  }
  if (node instanceof HtmlRawNode) {
    return handlers.raw?.(new TreeCursor(node, parent, index)) ?? node;
  }
  if (node instanceof HtmlCommentNode) {
    return handlers.comment?.(new TreeCursor(node, parent, index)) ?? node;
  }
  if (node instanceof HtmlDoctypeNode) {
    return handlers.doctype?.(new TreeCursor(node, parent, index)) ?? node;
  }
  if (node instanceof HtmlElementNode) {
    const replacement = handlers.element?.(new TreeCursor(node, parent, index)) ?? node;
    const cursor = new TreeCursor(replacement, parent, index);
    return replacement.with({
      children: replacement.children.map((child, childIndex) =>
        rewriteHtmlNode(child, cursor, childIndex, handlers),
      ),
    });
  }
  if (node instanceof HtmlFragmentNode) {
    const replacement = handlers.fragment?.(new TreeCursor(node, parent, index)) ?? node;
    const cursor = new TreeCursor(replacement, parent, index);
    return replacement.with({
      children: replacement.children.map((child, childIndex) =>
        rewriteHtmlNode(child, cursor, childIndex, handlers),
      ),
    });
  }
  if (node instanceof HtmlDocumentNode) {
    return rewriteHtmlDocument(node, parent, index, handlers);
  }
  const exhaustive: never = node;
  return exhaustive;
}

function rewriteHtmlDocument(
  document: HtmlDocumentNode,
  parent: TreeCursor<HtmlNode> | undefined,
  index: number | undefined,
  handlers: HtmlRewriteHandlers,
): HtmlDocumentNode {
  const replacement = handlers.document?.(new TreeCursor(document, parent, index)) ?? document;
  const cursor = new TreeCursor(replacement, parent, index);
  return replacement.with({
    children: replacement.children.map((child, childIndex) =>
      rewriteHtmlNode(child, cursor, childIndex, handlers),
    ),
  });
}

function htmlChildren(node: HtmlNode): readonly HtmlNode[] {
  switch (node.kind) {
    case "document":
    case "element":
    case "fragment":
      return node.children;
    default:
      return [];
  }
}
