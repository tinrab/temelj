import { type CompilerState, visible } from "./compile-analysis.ts";
import { CompileError } from "./errors.ts";
import { normalizeIdentifier } from "./identifier.ts";
import { javascriptPropertyName } from "./javascript-ast.ts";
import { javascriptExpressionUsesAwait, transformJavaScriptExpression } from "./javascript-jsx.ts";
import { hasJavaScriptToken } from "./javascript.ts";
import { resolveJsxName } from "./jsx-reference.ts";
import {
  BlockQuoteNode,
  CodeBlockNode,
  ContainerDirectiveNode,
  DeleteNode,
  DisplayMathNode,
  EmphasisNode,
  FootnoteReferenceNode,
  HardBreakNode,
  HeadingNode,
  ImageNode,
  ImageReferenceNode,
  InlineCodeNode,
  InlineMathNode,
  LeafDirectiveNode,
  LinkNode,
  LinkReferenceNode,
  ListNode,
  ListItemNode,
  BlockExpressionNode,
  DocumentNode,
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
  type JsxAttributeLike,
  type PhrasingContent,
  type SourceSpan,
  type SyntaxNode,
} from "./model.ts";
import { CodeWriter } from "./source-map.ts";

export function emitContent(
  writer: CodeWriter,
  document: DocumentNode,
  state: CompilerState,
): void {
  const children = visible(document.children);
  if (children.length > 1) {
    emitElement(writer, "_Fragment", [], children, document, state);
  } else {
    emitChildren(writer, children, state);
  }
}

export function documentUsesAwait(document: DocumentNode): boolean {
  for (const child of document.children) {
    if (nodeUsesAwait(child)) {
      return true;
    }
  }
  return false;
}

function nodeUsesAwait(node: SyntaxNode<string>): boolean {
  if (node instanceof InlineExpressionNode || node instanceof BlockExpressionNode) {
    return hasJavaScriptToken(node.code) && javascriptExpressionUsesAwait(node.code);
  }
  if (node instanceof JsxTextElementNode || node instanceof JsxFlowElementNode) {
    for (const attribute of node.attributes) {
      const code =
        attribute instanceof JsxSpreadAttributeNode
          ? attribute.code.slice(3).trimStart()
          : attribute.value instanceof JsxAttributeValueExpressionNode
            ? attribute.value.code
            : undefined;
      if (code !== undefined && javascriptExpressionUsesAwait(code)) {
        return true;
      }
    }
  }
  return node.children.some((child) => nodeUsesAwait(child));
}

function emitNode(
  writer: CodeWriter,
  node: FlowContent | PhrasingContent | ListItemNode | TableCellNode | TableRowNode,
  state: CompilerState,
): void {
  if (node instanceof TextNode) {
    writer.write(JSON.stringify(node.value), sourceSpan(node));
  } else if (node instanceof InlineExpressionNode || node instanceof BlockExpressionNode) {
    writer.write(
      `(${transformJavaScriptExpression(node.code, state, javascriptOrigin(node, 1))})`,
      sourceSpan(node),
    );
  } else if (node instanceof JsxTextElementNode || node instanceof JsxFlowElementNode) {
    emitJsxElement(writer, node, state);
  } else if (node instanceof ParagraphNode) {
    emitElement(writer, intrinsicTag("p", state), [], node.children, node, state);
  } else if (node instanceof HeadingNode) {
    emitElement(writer, intrinsicTag(`h${node.depth}`, state), [], node.children, node, state);
  } else if (node instanceof EmphasisNode) {
    emitElement(writer, intrinsicTag("em", state), [], node.children, node, state);
  } else if (node instanceof StrongNode) {
    emitElement(writer, intrinsicTag("strong", state), [], node.children, node, state);
  } else if (node instanceof DeleteNode) {
    emitElement(writer, intrinsicTag("del", state), [], node.children, node, state);
  } else if (node instanceof InlineCodeNode) {
    emitElement(
      writer,
      intrinsicTag("code", state),
      [],
      [new TextNode(node.value, node.origin)],
      node,
      state,
    );
  } else if (node instanceof HardBreakNode) {
    emitElement(writer, intrinsicTag("br", state), [], [], node, state);
  } else if (node instanceof LinkNode) {
    emitElement(
      writer,
      intrinsicTag("a", state),
      linkProperties(node.url, node.title),
      node.children,
      node,
      state,
    );
  } else if (node instanceof LinkReferenceNode) {
    const definition = state.definitions.get(normalizeIdentifier(node.identifier));
    if (definition === undefined) {
      writer.write(JSON.stringify(node.toSource()), sourceSpan(node));
    } else {
      emitElement(
        writer,
        intrinsicTag("a", state),
        linkProperties(definition.url, definition.title),
        node.children,
        node,
        state,
      );
    }
  } else if (node instanceof ImageNode) {
    emitElement(
      writer,
      intrinsicTag("img", state),
      imageProperties(node.url, node.alt, node.title),
      [],
      node,
      state,
    );
  } else if (node instanceof ImageReferenceNode) {
    const definition = state.definitions.get(normalizeIdentifier(node.identifier));
    if (definition === undefined) {
      writer.write(JSON.stringify(node.toSource()), sourceSpan(node));
    } else {
      emitElement(
        writer,
        intrinsicTag("img", state),
        imageProperties(definition.url, node.alt, definition.title),
        [],
        node,
        state,
      );
    }
  } else if (node instanceof FootnoteReferenceNode) {
    emitElement(
      writer,
      intrinsicTag("sup", state),
      [],
      [new TextNode(node.label, node.origin)],
      node,
      state,
    );
  } else if (node instanceof RawHtmlInlineNode || node instanceof RawHtmlBlockNode) {
    writer.write(JSON.stringify(node.value), sourceSpan(node));
  } else if (node instanceof CodeBlockNode) {
    const properties: Property[] =
      node.language === undefined
        ? []
        : [["className", JSON.stringify(`language-${node.language}`)]];
    if (node.meta !== undefined) {
      properties.push(["data-meta", JSON.stringify(node.meta)]);
    }
    emitElementExpression(writer, intrinsicTag("pre", state), [], node, state, () => {
      writer.write("children:");
      emitElement(
        writer,
        intrinsicTag("code", state),
        properties,
        [new TextNode(`${node.value}\n`, node.origin)],
        node,
        state,
      );
    });
  } else if (node instanceof ThematicBreakNode) {
    emitElement(writer, intrinsicTag("hr", state), [], [], node, state);
  } else if (node instanceof BlockQuoteNode) {
    emitElement(writer, intrinsicTag("blockquote", state), [], visible(node.children), node, state);
  } else if (node instanceof ListNode) {
    const properties =
      node.ordered && node.start !== 1 ? [["start", String(node.start)] as const] : [];
    emitElement(
      writer,
      intrinsicTag(node.ordered ? "ol" : "ul", state),
      properties,
      node.items,
      node,
      state,
    );
  } else if (node instanceof ListItemNode) {
    const children: Array<FlowContent | PhrasingContent> = [...visible(node.children)];
    if (node.checked !== undefined) {
      intrinsicTag("input", state);
      children.unshift(
        new InlineExpressionNode(
          runtimeCallCode(
            state,
            "_components.input",
            `{type: "checkbox", checked: ${node.checked}, disabled: true}`,
          ),
        ),
      );
    }
    emitElement(writer, intrinsicTag("li", state), [], children, node, state);
  } else if (node instanceof TableNode) {
    emitTable(writer, node, state);
  } else if (node instanceof InlineMathNode) {
    emitMath(writer, node, state);
  } else if (node instanceof DisplayMathNode) {
    emitMath(writer, node, state);
  } else if (node instanceof TextDirectiveNode) {
    emitElement(
      writer,
      intrinsicTag("span", state),
      directiveProperties(node.name, node.attributes.entries),
      node.label?.children ?? [],
      node,
      state,
    );
  } else if (node instanceof LeafDirectiveNode) {
    emitElement(
      writer,
      intrinsicTag("div", state),
      directiveProperties(node.name, node.attributes.entries),
      node.label?.children ?? [],
      node,
      state,
    );
  } else if (node instanceof ContainerDirectiveNode) {
    emitElement(
      writer,
      intrinsicTag("div", state),
      directiveProperties(node.name, node.attributes.entries),
      visible(node.body),
      node,
      state,
    );
  } else if (node instanceof TableCellNode || node instanceof TableRowNode) {
    CompileError.unsupportedStandaloneNode(node.kind);
  }
}

function emitMath(
  writer: CodeWriter,
  node: InlineMathNode | DisplayMathNode,
  state: CompilerState,
): void {
  const style = node instanceof InlineMathNode ? "inline" : "display";
  writer.write("(props.math ? ");
  const properties: Property[] = [
    ["source", JSON.stringify(node.value)],
    ["style", JSON.stringify(style)],
  ];
  if (node instanceof DisplayMathNode && node.meta !== undefined) {
    properties.push(["meta", JSON.stringify(node.meta)]);
  }
  emitElementExpression(writer, "props.math", properties, node, state);
  writer.write(" : ");
  if (node instanceof InlineMathNode) {
    emitElement(
      writer,
      intrinsicTag("code", state),
      [["className", JSON.stringify("language-math math-inline")]],
      [new TextNode(node.value, node.origin)],
      node,
      state,
    );
  } else {
    const properties: Property[] =
      node.meta === undefined ? [] : [["data-math-meta", JSON.stringify(node.meta)]];
    emitElementExpression(writer, intrinsicTag("pre", state), properties, node, state, () => {
      writer.write("children:");
      emitElement(
        writer,
        intrinsicTag("code", state),
        [["className", JSON.stringify("language-math math-display")]],
        [new TextNode(node.value, node.origin)],
        node,
        state,
      );
    });
  }
  writer.write(")");
}

type Property = readonly [name: string, value: string];

function emitElement(
  writer: CodeWriter,
  tag: string,
  properties: readonly Property[],
  children: readonly (
    | FlowContent
    | PhrasingContent
    | ListItemNode
    | TableCellNode
    | TableRowNode
  )[],
  node: SyntaxNode<string>,
  state: CompilerState,
): void {
  const shown = visible(children);
  emitElementExpression(
    writer,
    tag,
    properties,
    node,
    state,
    shown.length === 0
      ? undefined
      : () => {
          writer.write("children:");
          emitChildren(writer, shown, state);
        },
    shown.length > 1,
  );
}

function emitElementExpression(
  writer: CodeWriter,
  tag: string,
  properties: readonly Property[],
  node: SyntaxNode<string>,
  state: CompilerState,
  emitExtra?: () => void,
  multipleChildren = false,
): void {
  writer.write(
    state.development ? "_jsxDEV(" : multipleChildren ? "_jsxs(" : "_jsx(",
    sourceSpan(node),
  );
  writer.write(`${tag}, {`);
  let emitted = false;
  for (const [name, value] of properties) {
    if (emitted) {
      writer.write(", ");
    }
    writer.write(name === "..." ? `...${value}` : `${javascriptPropertyName(name)}:${value}`);
    emitted = true;
  }
  if (emitExtra !== undefined) {
    if (emitted) {
      writer.write(", ");
    }
    emitExtra();
  }
  writer.write("}");
  if (state.development) {
    writer.write(`, undefined, ${multipleChildren}, ${developmentSource(node, state)}, undefined`);
  }
  writer.write(")");
}

function emitChildren(
  writer: CodeWriter,
  children: readonly (
    | FlowContent
    | PhrasingContent
    | ListItemNode
    | TableCellNode
    | TableRowNode
  )[],
  state: CompilerState,
): void {
  if (children.length === 0) {
    writer.write("undefined");
  } else if (children.length === 1) {
    emitNode(writer, children[0], state);
  } else {
    writer.write("[");
    children.forEach((child, index) => {
      if (index > 0) {
        writer.write(", ");
      }
      emitNode(writer, child, state);
    });
    writer.write("]");
  }
}

function emitJsxElement(
  writer: CodeWriter,
  node: JsxTextElementNode | JsxFlowElementNode,
  state: CompilerState,
): void {
  const tag = jsxTag(node.name);
  const properties = jsxProperties(node.attributes, state);
  const children: readonly (FlowContent | PhrasingContent)[] = node.children;
  emitElement(writer, tag, properties, visible(children), node, state);
}

function jsxProperties(
  attributes: readonly JsxAttributeLike[],
  state: CompilerState,
): readonly Property[] {
  return attributes.map((attribute): Property => {
    if (attribute instanceof JsxSpreadAttributeNode) {
      return [
        "...",
        `(${transformJavaScriptExpression(
          attribute.code.slice(3).trimStart(),
          state,
          javascriptOrigin(attribute, 4),
        )})`,
      ];
    }
    if (!(attribute instanceof JsxAttributeNode)) {
      CompileError.unsupportedJsxAttribute();
    }
    const value = attribute.value;
    return [
      attribute.name,
      value === undefined
        ? "true"
        : value instanceof JsxAttributeValueExpressionNode
          ? `(${transformJavaScriptExpression(value.code, state, javascriptOrigin(value, 1))})`
          : JSON.stringify(value),
    ];
  });
}

function intrinsicTag(name: string, _state: CompilerState): string {
  return `_components.${name}`;
}

function jsxTag(name: string | undefined): string {
  return resolveJsxName(name).expression;
}

function emitTable(writer: CodeWriter, table: TableNode, state: CompilerState): void {
  const rows = table.children;
  const parts: Array<{ tag: "tbody" | "thead"; rows: readonly TableRowNode[] }> = [];
  if (rows.length > 0) {
    parts.push({ tag: "thead", rows: rows.slice(0, 1) });
  }
  if (rows.length > 1) {
    parts.push({ tag: "tbody", rows: rows.slice(1) });
  }
  emitElementExpression(
    writer,
    intrinsicTag("table", state),
    [],
    table,
    state,
    () => {
      writer.write("children:");
      if (parts.length === 1) {
        emitTablePart(writer, parts[0], table, state);
      } else {
        writer.write("[");
        parts.forEach((part, index) => {
          if (index > 0) {
            writer.write(", ");
          }
          emitTablePart(writer, part, table, state);
        });
        writer.write("]");
      }
    },
    parts.length > 1,
  );
}

function emitTablePart(
  writer: CodeWriter,
  part: { readonly tag: "tbody" | "thead"; readonly rows: readonly TableRowNode[] },
  table: TableNode,
  state: CompilerState,
): void {
  emitElementExpression(
    writer,
    intrinsicTag(part.tag, state),
    [],
    table,
    state,
    () => {
      writer.write("children:");
      if (part.rows.length === 1) {
        emitTableRow(writer, part.rows[0], part.tag === "thead", table, state);
      } else {
        writer.write("[");
        part.rows.forEach((row, index) => {
          if (index > 0) {
            writer.write(", ");
          }
          emitTableRow(writer, row, false, table, state);
        });
        writer.write("]");
      }
    },
    part.rows.length > 1,
  );
}

function emitTableRow(
  writer: CodeWriter,
  row: TableRowNode,
  header: boolean,
  table: TableNode,
  state: CompilerState,
): void {
  emitElementExpression(
    writer,
    intrinsicTag("tr", state),
    [],
    row,
    state,
    () => {
      writer.write("children:");
      writer.write("[");
      row.children.forEach((cell, index) => {
        if (index > 0) {
          writer.write(", ");
        }
        const alignment = table.alignments[index];
        const properties =
          alignment === undefined || alignment === "none"
            ? []
            : [["style", `{textAlign:${JSON.stringify(alignment)}}`] as const];
        emitElement(
          writer,
          intrinsicTag(header ? "th" : "td", state),
          properties,
          cell.children,
          cell,
          state,
        );
      });
      writer.write("]");
    },
    row.children.length > 1,
  );
}

function linkProperties(url: string, title?: string): readonly Property[] {
  return title === undefined
    ? [["href", JSON.stringify(url)]]
    : [
        ["href", JSON.stringify(url)],
        ["title", JSON.stringify(title)],
      ];
}

function imageProperties(url: string, alt: string, title?: string): readonly Property[] {
  return title === undefined
    ? [
        ["src", JSON.stringify(url)],
        ["alt", JSON.stringify(alt)],
      ]
    : [
        ["src", JSON.stringify(url)],
        ["alt", JSON.stringify(alt)],
        ["title", JSON.stringify(title)],
      ];
}

function directiveProperties(
  name: string,
  attributes: readonly { readonly name: string; readonly value: string }[],
): readonly Property[] {
  return [
    ["dataDirective", JSON.stringify(name)],
    ...attributes.map((attribute): Property => [attribute.name, JSON.stringify(attribute.value)]),
  ];
}

function sourceSpan(node: SyntaxNode<string>): SourceSpan | undefined {
  return node.origin;
}

function javascriptOrigin(
  node: SyntaxNode<string>,
  relativeOffset: number,
): { readonly file: SourceSpan["file"]; readonly offset: number } | undefined {
  const span = sourceSpan(node);
  return span === undefined ? undefined : { file: span.file, offset: span.start + relativeOffset };
}

function developmentSource(node: SyntaxNode<string>, state: CompilerState): string {
  const span = sourceSpan(node);
  if (span === undefined) {
    return "undefined";
  }
  const location = span.file.location(span.start);
  return `{fileName:${JSON.stringify(state.sourceName)},lineNumber:${location.line},columnNumber:${location.column}}`;
}

function runtimeCallCode(state: CompilerState, tag: string, properties: string): string {
  return state.development
    ? `_jsxDEV(${tag}, ${properties}, undefined, false, undefined, undefined)`
    : `_jsx(${tag}, ${properties})`;
}
