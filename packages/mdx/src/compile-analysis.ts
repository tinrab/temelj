import { CompileError } from "./errors.ts";
import { normalizeIdentifier } from "./identifier.ts";
import {
  childNode,
  collectPatternNames,
  nodeArray,
  nodeValue,
  type JavaScriptNode,
} from "./javascript-ast.ts";
import { analyzeJavaScriptExpression, transformJavaScriptProgram } from "./javascript-jsx.ts";
import { hasJavaScriptToken, parseJavaScriptProgram } from "./javascript.ts";
import { recordJsxReference, resolveJsxName } from "./jsx-reference.ts";
import {
  BlockExpressionNode,
  BlockQuoteNode,
  CodeBlockNode,
  ContainerDirectiveNode,
  DefinitionNode,
  DeleteNode,
  DisplayMathNode,
  DocumentNode,
  EmphasisNode,
  EsmNode,
  FootnoteDefinitionNode,
  FootnoteReferenceNode,
  FrontmatterNode,
  HardBreakNode,
  HeadingNode,
  ImageNode,
  ImageReferenceNode,
  InlineCodeNode,
  InlineExpressionNode,
  InlineMathNode,
  JsxAttributeValueExpressionNode,
  JsxFlowElementNode,
  JsxSpreadAttributeNode,
  JsxTextElementNode,
  LeafDirectiveNode,
  LinkNode,
  LinkReferenceNode,
  ListItemNode,
  ListNode,
  ParagraphNode,
  RawHtmlBlockNode,
  RawHtmlInlineNode,
  StrongNode,
  TableCellNode,
  TableNode,
  TableRowNode,
  TextDirectiveNode,
  TextNode,
  ThematicBreakNode,
  type FlowContent,
  type MdxNode,
  type PhrasingContent,
  type SourceSpan,
  type SyntaxNode,
} from "./model.ts";
import { walkTree } from "./tree.ts";

export interface CompilerState {
  readonly definitions: ReadonlyMap<string, DefinitionNode>;
  readonly development: boolean;
  readonly esm: readonly CompiledEsm[];
  readonly hasInternalLayout: boolean;
  readonly inScope: ReadonlySet<string>;
  readonly intrinsicTags: Set<string>;
  readonly missingReferences: Map<string, boolean>;
  readonly referencedComponents: Set<string>;
  readonly sourceName: string;
}

export interface CompiledEsm {
  readonly code: string;
  readonly span?: SourceSpan;
}

export function analyzeDocument(
  document: DocumentNode,
  options: Readonly<{ development?: boolean; sourceName?: string }> = {},
): CompilerState {
  const definitions = new Map<string, DefinitionNode>();
  const intrinsicTags = new Set<string>();
  const missingReferences = new Map<string, boolean>();
  const referencedComponents = new Set<string>();
  const inScope = new Set<string>();
  const esm: CompiledEsm[] = [];

  for (const { node } of walkTree<MdxNode>(document, (value) => value.children)) {
    if (node instanceof DefinitionNode && !definitions.has(normalizeIdentifier(node.identifier))) {
      definitions.set(normalizeIdentifier(node.identifier), node);
    }
  }

  for (const child of document.children) {
    if (!(child instanceof EsmNode)) {
      continue;
    }
    const program = parseJavaScriptProgram(child.code);
    collectProgramBindings(program, inScope);
    esm.push({ code: child.code, span: child.origin });
  }

  const state: CompilerState = {
    definitions,
    development: options.development ?? false,
    esm: [],
    hasInternalLayout: false,
    inScope,
    intrinsicTags,
    missingReferences,
    referencedComponents,
    sourceName: options.sourceName ?? "source.mdx",
  };
  const esmContext: CompilerState = {
    ...state,
    missingReferences: new Map(),
    referencedComponents: new Set(),
  };
  let hasInternalLayout = false;
  const compiledEsm = esm.map((entry): CompiledEsm => {
    const jsx = transformJavaScriptProgram(
      entry.code,
      esmContext,
      entry.span === undefined ? undefined : { file: entry.span.file, offset: entry.span.start },
    );
    const transformed = transformEsm(jsx, parseJavaScriptProgram(jsx));
    if (transformed.hasDefaultExport) {
      if (hasInternalLayout) {
        CompileError.multipleDefaultExports();
      }
      hasInternalLayout = true;
    }
    return { code: transformed.code, span: entry.span };
  });
  const result = {
    ...state,
    esm: compiledEsm,
    hasInternalLayout,
  };
  analyzeContentReferences(document, result);
  return result;
}

function analyzeContentReferences(document: DocumentNode, state: CompilerState): void {
  for (const child of visible(document.children)) {
    analyzeNodeReferences(child, state);
  }
}

function analyzeNodeReferences(
  node: FlowContent | PhrasingContent | ListItemNode | TableCellNode | TableRowNode,
  state: CompilerState,
): void {
  if (node instanceof InlineExpressionNode || node instanceof BlockExpressionNode) {
    analyzeJavaScriptExpression(node.code, state);
    return;
  }
  if (node instanceof JsxTextElementNode || node instanceof JsxFlowElementNode) {
    recordJsxReference(resolveJsxName(node.name), state);
    for (const attribute of node.attributes) {
      if (attribute instanceof JsxSpreadAttributeNode) {
        analyzeJavaScriptExpression(attribute.code.slice(3).trimStart(), state);
      } else if (attribute.value instanceof JsxAttributeValueExpressionNode) {
        analyzeJavaScriptExpression(attribute.value.code, state);
      }
    }
    analyzeChildren(node.children, state);
    return;
  }
  if (
    node instanceof TextNode ||
    node instanceof RawHtmlInlineNode ||
    node instanceof RawHtmlBlockNode
  ) {
    return;
  }
  if (node instanceof ParagraphNode) {
    addIntrinsic(state, "p");
    analyzeChildren(node.children, state);
  } else if (node instanceof HeadingNode) {
    addIntrinsic(state, `h${node.depth}`);
    analyzeChildren(node.children, state);
  } else if (node instanceof EmphasisNode) {
    addIntrinsic(state, "em");
    analyzeChildren(node.children, state);
  } else if (node instanceof StrongNode) {
    addIntrinsic(state, "strong");
    analyzeChildren(node.children, state);
  } else if (node instanceof DeleteNode) {
    addIntrinsic(state, "del");
    analyzeChildren(node.children, state);
  } else if (node instanceof InlineCodeNode) {
    addIntrinsic(state, "code");
  } else if (node instanceof HardBreakNode) {
    addIntrinsic(state, "br");
  } else if (node instanceof LinkNode) {
    addIntrinsic(state, "a");
    analyzeChildren(node.children, state);
  } else if (node instanceof LinkReferenceNode) {
    if (state.definitions.has(normalizeIdentifier(node.identifier))) {
      addIntrinsic(state, "a");
      analyzeChildren(node.children, state);
    }
  } else if (node instanceof ImageNode) {
    addIntrinsic(state, "img");
  } else if (node instanceof ImageReferenceNode) {
    if (state.definitions.has(normalizeIdentifier(node.identifier))) {
      addIntrinsic(state, "img");
    }
  } else if (node instanceof FootnoteReferenceNode) {
    addIntrinsic(state, "sup");
  } else if (node instanceof CodeBlockNode) {
    addIntrinsic(state, "pre", "code");
  } else if (node instanceof ThematicBreakNode) {
    addIntrinsic(state, "hr");
  } else if (node instanceof BlockQuoteNode) {
    addIntrinsic(state, "blockquote");
    analyzeChildren(visible(node.children), state);
  } else if (node instanceof ListNode) {
    addIntrinsic(state, node.ordered ? "ol" : "ul");
    analyzeChildren(node.items, state);
  } else if (node instanceof ListItemNode) {
    addIntrinsic(state, "li");
    if (node.checked !== undefined) {
      addIntrinsic(state, "input");
    }
    analyzeChildren(visible(node.children), state);
  } else if (node instanceof TableNode) {
    analyzeTableReferences(node, state);
  } else if (node instanceof InlineMathNode) {
    addIntrinsic(state, "code");
  } else if (node instanceof DisplayMathNode) {
    addIntrinsic(state, "pre", "code");
  } else if (node instanceof TextDirectiveNode) {
    addIntrinsic(state, "span");
    analyzeChildren(node.label?.children ?? [], state);
  } else if (node instanceof LeafDirectiveNode) {
    addIntrinsic(state, "div");
    analyzeChildren(node.label?.children ?? [], state);
  } else if (node instanceof ContainerDirectiveNode) {
    addIntrinsic(state, "div");
    analyzeChildren(visible(node.body), state);
  } else if (node instanceof TableCellNode || node instanceof TableRowNode) {
    CompileError.unsupportedStandaloneNode(node.kind);
  }
}

function analyzeChildren(
  children: readonly (
    | FlowContent
    | PhrasingContent
    | ListItemNode
    | TableCellNode
    | TableRowNode
  )[],
  state: CompilerState,
): void {
  for (const child of visible(children)) {
    analyzeNodeReferences(child, state);
  }
}

function analyzeTableReferences(table: TableNode, state: CompilerState): void {
  addIntrinsic(state, "table");
  if (table.children.length > 0) {
    addIntrinsic(state, "thead");
  }
  if (table.children.length > 1) {
    addIntrinsic(state, "tbody");
  }
  for (const [rowIndex, row] of table.children.entries()) {
    addIntrinsic(state, "tr");
    for (const cell of row.children) {
      addIntrinsic(state, rowIndex === 0 ? "th" : "td");
      analyzeChildren(cell.children, state);
    }
  }
}

function addIntrinsic(state: CompilerState, ...names: readonly string[]): void {
  for (const name of names) {
    state.intrinsicTags.add(name);
  }
}

export function visible<T extends SyntaxNode<string>>(nodes: readonly T[]): T[] {
  return nodes.filter(
    (node) =>
      !(node instanceof DefinitionNode) &&
      !(node instanceof FootnoteDefinitionNode) &&
      !(node instanceof FrontmatterNode) &&
      !(
        (node instanceof InlineExpressionNode || node instanceof BlockExpressionNode) &&
        !hasJavaScriptToken(node.code)
      ) &&
      !(node instanceof EsmNode),
  );
}

function transformEsm(
  source: string,
  program: JavaScriptNode,
): { readonly code: string; readonly hasDefaultExport: boolean } {
  const body = nodeArray(program, "body");
  let cursor = 0;
  let hasDefaultExport = false;
  const result: string[] = [];
  for (const statement of body) {
    result.push(source.slice(cursor, statement.start));
    if (statement.type === "ExportDefaultDeclaration") {
      hasDefaultExport = true;
      const declaration = childNode(nodeValue(statement, "declaration"));
      if (declaration === undefined) {
        CompileError.defaultExportDeclarationMissing();
      }
      result.push(`const Layout = (${source.slice(declaration.start, declaration.end)});`);
    } else if (statement.type === "ExportNamedDeclaration") {
      const transformed = transformNamedDefaultExport(source, statement);
      if (transformed === undefined) {
        result.push(source.slice(statement.start, statement.end));
      } else {
        hasDefaultExport = true;
        result.push(transformed);
      }
    } else {
      result.push(source.slice(statement.start, statement.end));
    }
    cursor = statement.end;
  }
  result.push(source.slice(cursor));
  return { code: result.join(""), hasDefaultExport };
}

function transformNamedDefaultExport(
  source: string,
  statement: JavaScriptNode,
): string | undefined {
  const specifiers = nodeArray(statement, "specifiers");
  const layout = specifiers.find(
    (specifier) => identifierValue(childNode(nodeValue(specifier, "exported"))) === "default",
  );
  if (layout === undefined) {
    return undefined;
  }

  const local = childNode(nodeValue(layout, "local"));
  const localName = identifierValue(local);
  if (local === undefined || localName === undefined) {
    CompileError.defaultExportBindingMissing();
  }

  const from = childNode(nodeValue(statement, "source"));
  const layoutDeclaration =
    from === undefined
      ? `const Layout = ${localName};`
      : `import {${localName} as Layout} from ${source.slice(from.start, from.end)};`;
  const remaining = specifiers.filter((specifier) => specifier !== layout);
  if (remaining.length === 0) {
    return layoutDeclaration;
  }

  const suffix =
    from === undefined
      ? ";"
      : ` from ${source.slice(from.start, statement.end).replace(/;?$/u, ";")}`;
  return `${layoutDeclaration}\nexport {${remaining
    .map((specifier) => source.slice(specifier.start, specifier.end))
    .join(", ")}}${suffix}`;
}

function collectProgramBindings(program: JavaScriptNode, names: Set<string>): void {
  for (const statement of nodeArray(program, "body")) {
    if (statement.type === "ImportDeclaration") {
      for (const specifier of nodeArray(statement, "specifiers")) {
        collectPatternNames(childNode(nodeValue(specifier, "local")), names);
      }
    } else if (statement.type === "ExportNamedDeclaration") {
      collectDeclarationNames(childNode(nodeValue(statement, "declaration")), names);
    } else {
      collectDeclarationNames(statement, names);
    }
  }
}

function identifierValue(node: JavaScriptNode | undefined): string | undefined {
  if (node === undefined) {
    return undefined;
  }
  const name = nodeValue(node, "name");
  const value = nodeValue(node, "value");
  return typeof name === "string" ? name : typeof value === "string" ? value : undefined;
}

function collectDeclarationNames(node: JavaScriptNode | undefined, names: Set<string>): void {
  if (node === undefined) {
    return;
  }
  if (node.type === "VariableDeclaration") {
    for (const declaration of nodeArray(node, "declarations")) {
      collectPatternNames(childNode(nodeValue(declaration, "id")), names);
    }
  } else if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
    collectPatternNames(childNode(nodeValue(node, "id")), names);
  }
}
