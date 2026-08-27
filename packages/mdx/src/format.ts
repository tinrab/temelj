import {
  unsafePatterns,
  compileUnsafePattern,
  safeSource,
  type FormatConstruct,
  type FormatSafeInfo,
  type FormatSafetyState,
  type FormatUnsafePattern,
} from "./format-safe.ts";
import { createFormatTracker, type FormatTrackInfo } from "./format-track.ts";
import { normalizeIdentifier } from "./identifier.ts";
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
  InlineExpressionNode,
  JsxAttributeNode,
  JsxAttributeValueExpressionNode,
  JsxFlowElementNode,
  JsxSpreadAttributeNode,
  JsxTextElementNode,
  ParagraphNode,
  RawHtmlInlineNode,
  StrongNode,
  TableNode,
  TableCellNode,
  TableRowNode,
  TextNode,
  TextDirectiveNode,
  ThematicBreakNode,
  type FormatOptions,
  type MdxNode,
} from "./model.ts";
import {
  frontmatterFence,
  resolveSyntaxOptions,
  type MathFormat,
  type ResolvedSyntaxOptions,
} from "./syntax-options.ts";
import { selectTree } from "./tree.ts";
import { encodeNumericCharacterReference } from "./utility.ts";

interface FormatInfo extends FormatTrackInfo {
  readonly after: string;
  readonly before: string;
}

const rootInfo: FormatInfo = {
  after: "\n",
  before: "\n",
  lineShift: 0,
  now: { line: 1, column: 1 },
};

/** Serialize an owned syntax node through the shared Formatter. */
export function format(node: MdxNode, options: FormatOptions = {}): string {
  return new Formatter(options, containsDirective(node), mathFormats(node)).format(node, rootInfo);
}

class Formatter implements FormatSafetyState {
  public readonly stack: FormatConstruct[] = [];
  public readonly unsafe: readonly FormatUnsafePattern[];
  private readonly compiledPatterns = new Map<FormatUnsafePattern, RegExp>();
  private readonly options: FormatOptions;
  private readonly syntax: ResolvedSyntaxOptions;
  private bulletLastUsed: "*" | "+" | "-" | "." | ")" | undefined;

  public constructor(
    options: FormatOptions,
    containsDirectives: boolean,
    nodeMathFormats: ReadonlySet<MathFormat>,
  ) {
    this.options = { ...options };
    this.syntax = resolveSyntaxOptions(options.syntax);
    this.unsafe = [
      ...unsafePatterns,
      { character: "{", inConstruct: "phrasing" },
      { atBreak: true, character: "{" },
      { character: "<", inConstruct: "phrasing" },
      { atBreak: true, character: "<" },
      ...(containsDirectives || this.syntax.directives
        ? ([
            {
              before: "[^:]",
              character: ":",
              after: "[A-Za-z]",
              inConstruct: "phrasing",
            },
            { atBreak: true, character: ":", after: ":" },
          ] satisfies FormatUnsafePattern[])
        : []),
      ...(nodeMathFormats.has("dollar") || this.syntax.math.includes("dollar")
        ? ([
            {
              character: "$",
              inConstruct: "phrasing",
            },
            { character: "$", inConstruct: "mathFlowMeta" },
            { atBreak: true, character: "$", after: "\\$" },
          ] satisfies FormatUnsafePattern[])
        : []),
      ...this.syntax.frontmatter.map(
        (format) =>
          ({
            atBreak: true,
            character: frontmatterFence(format).charAt(0),
            after: escapeRegularExpression(frontmatterFence(format).slice(1)),
          }) satisfies FormatUnsafePattern,
      ),
    ];
  }

  public compilePattern(pattern: FormatUnsafePattern): RegExp {
    const cached = this.compiledPatterns.get(pattern);
    if (cached !== undefined) {
      return cached;
    }
    const expression = compileUnsafePattern(pattern);
    this.compiledPatterns.set(pattern, expression);
    return expression;
  }

  public format(node: MdxNode, info: FormatInfo): string {
    switch (node.kind) {
      case "document":
        return this.flow(node.children, info);
      case "paragraph":
        return this.paragraph(node, info);
      case "heading":
        return this.heading(node, info);
      case "thematicBreak":
        return this.thematicBreak();
      case "codeBlock":
        return this.codeBlock(node, info);
      case "blockquote":
        return this.blockQuote(node, info);
      case "list":
        return this.list(node, info);
      case "listItem":
        return this.flow(node.children, info, node.spread);
      case "table":
        return this.table(node, info);
      case "tableRow":
        return this.tableRow(node, info);
      case "tableCell":
        return this.tableCell(node, info);
      case "definition":
        return this.definition(node, info);
      case "footnoteDefinition":
        return this.footnoteDefinition(node, info);
      case "frontmatter":
        return `${frontmatterFence(node.format)}${node.value.length === 0 ? "" : `\n${node.value}`}\n${frontmatterFence(node.format)}`;
      case "directiveLabel":
        return this.directiveLabel(node, info);
      case "textDirective":
        return this.directive(node, info, ":");
      case "leafDirective":
        return this.directive(node, info, "::");
      case "containerDirective":
        return this.containerDirective(node, info);
      case "displayMath":
        return this.displayMath(node, info);
      case "rawHtmlBlock":
      case "rawHtmlInline":
        return node.value;
      case "text":
        return this.safe(node.value, info);
      case "emphasis":
        return this.attention(
          node.children,
          info,
          this.attentionMarker(this.options.emphasis ?? "*", false),
          false,
        );
      case "strong":
        return this.attention(
          node.children,
          info,
          this.attentionMarker(this.options.strong ?? "*", true),
          true,
        );
      case "delete":
        return this.strikethrough(node.children, info);
      case "inlineCode":
        return this.stack.includes("tableCell")
          ? formatInlineCode(node.value).replaceAll("|", "\\|")
          : formatInlineCode(node.value);
      case "inlineMath":
        return this.inlineMath(node);
      case "hardBreak":
        return "\\\n";
      case "link":
        return this.link(node, info);
      case "image":
        return this.image(node, info);
      case "linkReference":
        return this.linkReference(node, info);
      case "imageReference":
        return this.imageReference(node, info);
      case "footnoteReference":
        return this.footnoteReference(node);
      case "inlineExpression":
      case "blockExpression":
        return `{${indentExpression(node.code)}}`;
      case "esm":
        return node.code;
      case "jsxAttributeValueExpression":
        return `{${indentExpression(node.code)}}`;
      case "jsxAttribute":
        return this.jsxAttribute(node);
      case "jsxSpreadAttribute":
        return `{${indentExpression(node.code)}}`;
      case "jsxTextElement":
        return this.jsxTextElement(node, info);
      case "jsxFlowElement":
        return this.jsxFlowElement(node, info);
      default: {
        const exhaustive: never = node;
        return exhaustive;
      }
    }
  }

  private flow(nodes: readonly MdxNode[], info: FormatInfo, spread?: boolean): string {
    const tracker = createFormatTracker(info);
    const output: string[] = [];
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      output.push(
        tracker.move(this.format(node, { after: "\n", before: "\n", ...tracker.current() })),
      );
      const next = nodes[index + 1];
      if (next !== undefined) {
        output.push(tracker.move(this.join(node, next, spread)));
      }
      if (!(node instanceof ListNode)) {
        this.bulletLastUsed = undefined;
      }
    }
    return output.join("");
  }

  private join(left: MdxNode, right: MdxNode, spread?: boolean): string {
    if (
      this.options.tightDefinitions === true &&
      left instanceof DefinitionNode &&
      right instanceof DefinitionNode
    ) {
      return "\n";
    }
    if (spread !== undefined) {
      return spread ? "\n\n" : "\n";
    }
    return "\n\n";
  }

  private paragraph(node: ParagraphNode, info: FormatInfo): string {
    const exit = this.enter("paragraph");
    const exitPhrasing = this.enter("phrasing");
    const value = this.phrasing(node.children, info);
    exitPhrasing();
    exit();
    return value;
  }

  private jsxAttribute(node: JsxAttributeNode): string {
    if (node.value === undefined) {
      return node.name;
    }
    if (node.value instanceof JsxAttributeValueExpressionNode) {
      return `${node.name}={${indentExpression(node.value.code)}}`;
    }
    const quote = this.options.quote ?? '"';
    return `${node.name}=${quote}${escapeJsxAttribute(node.value, quote)}${quote}`;
  }

  private jsxTextElement(node: JsxTextElementNode, info: FormatInfo): string {
    const opening = this.jsxOpening(node.name, node.attributes, node.children.length === 0);
    if (node.name !== undefined && node.children.length === 0) {
      return opening;
    }
    const exit = this.enter("phrasing");
    const body = this.phrasing(node.children, { ...info, after: "<", before: ">" });
    exit();
    return `${opening}${body}</${node.name ?? ""}>`;
  }

  private jsxFlowElement(node: JsxFlowElementNode, info: FormatInfo): string {
    const opening = this.jsxOpening(node.name, node.attributes, node.children.length === 0);
    if (node.name !== undefined && node.children.length === 0) {
      return opening;
    }
    if (node.children.length === 0) {
      return `${opening}</>`;
    }
    const body = indentLines(
      this.flow(node.children, { ...info, after: "\n", before: "\n" }),
      (line, blank) => (blank ? "" : `  ${line}`),
    );
    return `${opening}\n${body}\n</${node.name ?? ""}>`;
  }

  private jsxOpening(
    name: string | undefined,
    attributes: readonly (JsxAttributeNode | JsxSpreadAttributeNode)[],
    empty: boolean,
  ): string {
    if (name === undefined && attributes.length > 0) {
      throw new Error("A JSX fragment cannot have attributes");
    }
    const values = attributes.map((attribute) =>
      attribute instanceof JsxAttributeNode
        ? this.jsxAttribute(attribute)
        : `{${indentExpression(attribute.code)}}`,
    );
    const suffix = name !== undefined && empty ? " />" : ">";
    return `<${name ?? ""}${values.length === 0 ? "" : ` ${values.join(" ")}`}${suffix}`;
  }

  private phrasing(nodes: readonly MdxNode[], info: FormatInfo): string {
    let tracker = createFormatTracker(info);
    const output: string[] = [];
    let before = info.before;
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      let nextIndex = index + 1;
      let text = node instanceof TextNode ? node.value : undefined;
      let nextText = nodes[nextIndex];
      while (text !== undefined && nextText instanceof TextNode) {
        text += nextText.value;
        nextIndex++;
        nextText = nodes[nextIndex];
      }
      const next = nodes[nextIndex];
      const after = next === undefined ? info.after : peek(next, this.options);
      if (
        output.length > 0 &&
        (before === "\r" || before === "\n") &&
        node instanceof RawHtmlInlineNode
      ) {
        output[output.length - 1] = output[output.length - 1].replace(/(?:\r\n?|\n)$/u, (ending) =>
          encodeLineEnding(ending),
        );
        before = ";";
        tracker = createFormatTracker(info);
        tracker.move(output.join(""));
      }
      let value =
        text === undefined
          ? this.format(node, { after, before, ...tracker.current() })
          : encodeBlankLineEndings(
              this.safe(text, {
                after,
                before,
                ...tracker.current(),
              }),
            );
      if (text !== undefined && after === "[" && value.endsWith("!") && !value.endsWith("\\!")) {
        value = `${value.slice(0, -1)}\\!`;
      }
      tracker.move(value);
      output.push(value);
      before = value.slice(-1);
      index = nextIndex - 1;
    }
    return output.join("");
  }

  private heading(node: HeadingNode, info: FormatInfo): string {
    if (node.depth < 3 && node.children.some(containsLineEnding)) {
      const exit = this.enter("headingSetext");
      const exitPhrasing = this.enter("phrasing");
      const content = this.phrasing(node.children, { ...info, after: "\n", before: "\n" });
      exitPhrasing();
      exit();
      const lastLineStart = Math.max(content.lastIndexOf("\r"), content.lastIndexOf("\n")) + 1;
      return `${content}\n${(node.depth === 1 ? "=" : "-").repeat(
        Math.max(1, content.length - lastLineStart),
      )}`;
    }
    const sequence = "#".repeat(node.depth);
    const exit = this.enter("headingAtx");
    const exitPhrasing = this.enter("phrasing");
    const tracker = createFormatTracker(info);
    tracker.move(`${sequence} `);
    let content = this.phrasing(node.children, {
      after: "\n",
      before: "# ",
      ...tracker.current(),
    });
    if (/^[\t ]/u.test(content)) {
      content = encodeNumericCharacterReference(content.codePointAt(0) ?? 32) + content.slice(1);
    }
    if (content.endsWith("#")) {
      content = `${content.slice(0, -1)}${encodeNumericCharacterReference(35)}`;
    }
    exitPhrasing();
    exit();
    if (content.length === 0) {
      return sequence;
    }
    return `${sequence} ${content}${this.options.closeAtx === true ? ` ${sequence}` : ""}`;
  }

  private thematicBreak(): string {
    const marker = this.options.rule ?? "-";
    const repetition = Math.max(3, this.options.ruleRepetition ?? 3);
    const value = `${marker}${this.options.ruleSpaces === true ? " " : ""}`.repeat(repetition);
    const rule = this.options.ruleSpaces === true ? value.slice(0, -1) : value;
    const frontmatterFences = new Set<string>(this.syntax.frontmatter.map(frontmatterFence));
    if (!frontmatterFences.has(rule)) {
      return rule;
    }

    let separator = " ";
    let safeRule = Array.from({ length: repetition }, () => marker).join(separator);
    while (frontmatterFences.has(safeRule)) {
      separator += " ";
      safeRule = Array.from({ length: repetition }, () => marker).join(separator);
    }
    return safeRule;
  }

  private codeBlock(node: CodeBlockNode, info: FormatInfo): string {
    const marker = this.options.fence ?? "`";
    const suffix = marker === "`" ? "GraveAccent" : "Tilde";
    const sequence = marker.repeat(Math.max(3, longestRun(node.value, marker) + 1));
    const tracker = createFormatTracker(info);
    let value = tracker.move(sequence);
    if (node.language !== undefined && node.language.length > 0) {
      const exitLanguage = this.enter(`codeFencedLang${suffix}`);
      value += tracker.move(this.safe(node.language, { after: " ", before: value, encode: ["`"] }));
      exitLanguage();
    }
    if (node.meta !== undefined && node.meta.length > 0) {
      const exitMeta = this.enter(`codeFencedMeta${suffix}`);
      value += tracker.move(
        ` ${this.safe(node.meta, { after: "\n", before: value, encode: ["`"] })}`,
      );
      exitMeta();
    }
    value += tracker.move("\n");
    if (node.value.length > 0) {
      value += tracker.move(`${node.value}\n`);
    }
    return value + sequence;
  }

  private blockQuote(node: BlockQuoteNode, info: FormatInfo): string {
    const exit = this.enter("blockquote");
    const tracker = createFormatTracker(info);
    tracker.move("> ");
    tracker.shift(2);
    const value = indentLines(
      this.flow(node.children, { after: "\n", before: "\n", ...tracker.current() }),
      (line, blank) => `>${blank ? "" : " "}${line}`,
    );
    exit();
    return value;
  }

  private list(node: ListNode, info: FormatInfo): string {
    const exit = this.enter("list");
    let marker: "*" | "+" | "-" | "." | ")" = node.ordered
      ? (this.options.bulletOrdered ?? ".")
      : (this.options.bullet ?? "-");
    if (
      this.bulletLastUsed === marker ||
      (!node.ordered &&
        marker === (this.options.rule ?? "-") &&
        node.items.some((item) => item.children[0] instanceof ThematicBreakNode))
    ) {
      marker = alternateListMarker(marker);
    }
    const values = node.items.map((item, index) => this.listItem(item, node, index, marker, info));
    this.bulletLastUsed = marker;
    exit();
    return values.join(node.spread ? "\n\n" : "\n");
  }

  private listItem(
    item: ListItemNode,
    parent: ListNode,
    index: number,
    listMarker: "*" | "+" | "-" | "." | ")",
    info: FormatInfo,
  ): string {
    const marker = parent.ordered
      ? `${parent.start + (this.options.incrementListMarker === false ? 0 : index)}${listMarker}`
      : listMarker;
    let size = marker.length + 1;
    const indentation = this.options.listItemIndent ?? "one";
    if (indentation === "tab" || (indentation === "mixed" && (parent.spread || item.spread))) {
      size = Math.ceil(size / 4) * 4;
    }
    const prefix = `${marker}${" ".repeat(size - marker.length)}`;
    const tracker = createFormatTracker(info);
    tracker.move(prefix);
    tracker.shift(size);
    const exit = this.enter("listItem");
    let body = this.flow(
      item.children,
      { after: "\n", before: "\n", ...tracker.current() },
      parent.spread || item.spread,
    );
    if (item.checked !== undefined && item.children[0] instanceof ParagraphNode) {
      body = `[${item.checked ? "x" : " "}] ${body}`;
    }
    const value = indentLines(body, (line, blank, lineIndex) =>
      lineIndex === 0
        ? `${blank ? marker : prefix}${line}`
        : `${blank ? "" : " ".repeat(size)}${line}`,
    );
    exit();
    return value;
  }

  private table(node: TableNode, info: FormatInfo): string {
    const columns = node.alignments.length;
    if (columns === 0) {
      return "";
    }
    const exit = this.enter("table");
    const matrix = node.children.map((row) =>
      Array.from({ length: columns }, (_, index) =>
        row.children[index] === undefined ? "" : this.tableCell(row.children[index], info),
      ),
    );
    if (matrix.length === 0) {
      matrix.push(Array.from({ length: columns }, () => ""));
    }
    const measure = this.options.tableStringLength ?? ((value: string): number => value.length);
    const alignPipes = this.options.tablePipeAlign !== false;
    const widths = Array.from({ length: columns }, (_, column) => {
      const content = alignPipes ? Math.max(...matrix.map((row) => measure(row[column] ?? ""))) : 0;
      return Math.max(3, content);
    });
    const delimiter = node.alignments.map((alignment, column) =>
      tableDelimiter(alignment, widths[column]),
    );
    const rows = [matrix[0], delimiter, ...matrix.slice(1)].map((row) =>
      serializeTableRow(row, widths, this.options.tableCellPadding !== false, measure),
    );
    exit();
    return rows.join("\n");
  }

  private tableRow(node: TableRowNode, info: FormatInfo): string {
    const values = node.children.map((cell) => this.tableCell(cell, info));
    return serializeTableRow(
      values,
      values.map((value) => Math.max(3, value.length)),
      this.options.tableCellPadding !== false,
      (value) => value.length,
    );
  }

  private tableCell(node: TableCellNode, info: FormatInfo): string {
    const exitCell = this.enter("tableCell");
    const exitPhrasing = this.enter("phrasing");
    const value = this.phrasing(node.children, { ...info, after: "|", before: "|" });
    exitPhrasing();
    exitCell();
    return value;
  }

  private definition(node: DefinitionNode, info: FormatInfo): string {
    const exit = this.enter("definition");
    const tracker = createFormatTracker(info);
    const exitLabel = this.enter("label");
    let value = tracker.move("[");
    value += tracker.move(formatAssociationIdentifier(node.identifier));
    value += tracker.move("]: ");
    exitLabel();
    value += tracker.move(this.destination(node.url, value, node.title === undefined ? "\n" : " "));
    if (node.title !== undefined) {
      value += tracker.move(this.title(node.title, value));
    }
    exit();
    return value;
  }

  private footnoteDefinition(node: FootnoteDefinitionNode, info: FormatInfo): string {
    const exit = this.enter("footnoteDefinition");
    const tracker = createFormatTracker(info);
    const exitLabel = this.enter("label");
    let value = tracker.move("[^");
    value += tracker.move(this.safe(node.label, { before: value, after: "]" }));
    value += tracker.move("]:");
    exitLabel();
    if (node.children.length > 0) {
      tracker.shift(4);
      const content = this.flow(node.children, {
        after: "\n",
        before: "\n",
        ...tracker.current(),
      });
      const blankFirst = this.options.footnoteFirstLineBlank === true;
      value +=
        (blankFirst ? "\n" : " ") +
        indentLines(content, (line, blank, lineIndex) =>
          !blankFirst && lineIndex === 0 ? line : `${blank ? "" : "    "}${line}`,
        );
    }
    exit();
    return value;
  }

  private footnoteReference(node: FootnoteReferenceNode): string {
    const exit = this.enter("footnoteReference");
    const exitReference = this.enter("reference");
    const value = `[^${this.safe(node.label, { before: "[^", after: "]" })}]`;
    exitReference();
    exit();
    return value;
  }

  private directive(
    node: TextDirectiveNode | LeafDirectiveNode,
    info: FormatInfo,
    sequence: ":" | "::",
  ): string {
    const exit = this.enter(node.kind);
    const tracker = createFormatTracker(info);
    let value = tracker.move(`${sequence}${node.name}`);
    if (node.label !== undefined) {
      value += tracker.move(
        this.directiveLabel(node.label, {
          after: "{",
          before: value,
          ...tracker.current(),
        }),
      );
    }
    value += tracker.move(formatDirectiveAttributes(node.attributes.entries, this.options));
    exit();
    return value;
  }

  private containerDirective(node: ContainerDirectiveNode, info: FormatInfo): string {
    const exit = this.enter("containerDirective");
    const tracker = createFormatTracker(info);
    const sequence = ":".repeat(containerDirectiveFenceSize(node));
    let value = tracker.move(`${sequence}${node.name}`);
    if (node.label !== undefined) {
      value += tracker.move(
        this.directiveLabel(node.label, {
          after: "{",
          before: value,
          ...tracker.current(),
        }),
      );
    }
    value += tracker.move(formatDirectiveAttributes(node.attributes.entries, this.options));
    if (node.body.length > 0) {
      value += tracker.move("\n");
      value += tracker.move(
        this.flow(node.body, {
          after: "\n",
          before: "\n",
          ...tracker.current(),
        }),
      );
    }
    value += tracker.move(`\n${sequence}`);
    exit();
    return value;
  }

  private directiveLabel(node: DirectiveLabelNode, info: FormatInfo): string {
    const exit = this.enter("directiveLabel");
    const exitLabel = this.enter("label");
    const tracker = createFormatTracker(info);
    const opening = tracker.move("[");
    const content = tracker.move(
      this.phrasing(node.children, {
        after: "]",
        before: opening,
        ...tracker.current(),
      }),
    );
    exitLabel();
    exit();
    return `${opening}${content}]`;
  }

  private displayMath(node: DisplayMathNode, info: FormatInfo): string {
    if (node.format === "tex") {
      const exit = this.enter("mathFlow");
      const tracker = createFormatTracker(info);
      let value = tracker.move("\\[");
      value += tracker.move("\n");
      if (node.value.length > 0) {
        value += tracker.move(`${node.value}\n`);
      }
      value += tracker.move("\\]");
      exit();
      return value;
    }
    const sequence = "$".repeat(Math.max(2, longestRun(node.value, "$") + 1));
    const exit = this.enter("mathFlow");
    const tracker = createFormatTracker(info);
    let value = tracker.move(sequence);
    if (node.meta !== undefined && node.meta.length > 0) {
      const exitMeta = this.enter("mathFlowMeta");
      value += tracker.move(
        this.safe(node.meta, {
          after: "\n",
          before: value,
          encode: ["$"],
          ...tracker.current(),
        }),
      );
      exitMeta();
    }
    value += tracker.move("\n");
    if (node.value.length > 0) {
      value += tracker.move(`${node.value}\n`);
    }
    value += tracker.move(sequence);
    exit();
    return value;
  }

  private inlineMath(node: InlineMathNode): string {
    if (node.format === "tex") {
      return `\\(${node.value}\\)`;
    }
    let value = node.value;
    let size = 1;
    while (new RegExp(`(^|[^$])${"\\$".repeat(size)}([^$]|$)`, "u").test(value)) {
      size++;
    }
    const sequence = "$".repeat(size);
    if (
      /[^ \r\n]/u.test(value) &&
      ((/^[ \r\n]/u.test(value) && /[ \r\n]$/u.test(value)) || /^\$|\$$/u.test(value))
    ) {
      value = ` ${value} `;
    }
    for (const pattern of this.unsafe) {
      if (pattern.atBreak !== true) {
        continue;
      }
      const expression = this.compilePattern(pattern);
      expression.lastIndex = 0;
      let match = expression.exec(value);
      while (match !== null) {
        let position = match.index;
        if (value.charCodeAt(position) === 10 && value.charCodeAt(position - 1) === 13) {
          position--;
        }
        value = `${value.slice(0, position)} ${value.slice(match.index + 1)}`;
        expression.lastIndex = 0;
        match = expression.exec(value);
      }
    }
    const exit = this.enter("inlineMath");
    const result = `${sequence}${value}${sequence}`;
    exit();
    return result;
  }

  private attention(
    children: readonly MdxNode[],
    info: FormatInfo,
    marker: "*" | "_",
    strong: boolean,
  ): string {
    const sequence = strong ? marker + marker : marker;
    const exit = this.enter(strong ? "strong" : "emphasis");
    const tracker = createFormatTracker(info);
    const before = tracker.move(sequence);
    const content = tracker.move(
      this.phrasing(children, { after: marker, before, ...tracker.current() }),
    );
    exit();
    return before + content + sequence;
  }

  private attentionMarker(marker: "*" | "_", strong: boolean): "*" | "_" {
    return this.stack.includes(strong ? "strong" : "emphasis")
      ? marker === "*"
        ? "_"
        : "*"
      : marker;
  }

  private strikethrough(children: readonly MdxNode[], info: FormatInfo): string {
    const exit = this.enter("strikethrough");
    const tracker = createFormatTracker(info);
    const before = tracker.move("~~");
    const content = tracker.move(
      this.phrasing(children, { after: "~", before, ...tracker.current() }),
    );
    exit();
    return before + content + "~~";
  }

  private link(node: LinkNode, info: FormatInfo): string {
    const exit = this.enter("link");
    const tracker = createFormatTracker(info);
    const exitLabel = this.enter("label");
    let value = tracker.move("[");
    value += tracker.move(
      this.phrasing(node.children, { after: "]", before: value, ...tracker.current() }),
    );
    value += tracker.move("](");
    exitLabel();
    value += tracker.move(this.destination(node.url, value, node.title === undefined ? ")" : " "));
    if (node.title !== undefined) {
      value += tracker.move(this.title(node.title, value));
    }
    exit();
    return value + ")";
  }

  private image(node: ImageNode, info: FormatInfo): string {
    const exit = this.enter("image");
    const tracker = createFormatTracker(info);
    const exitLabel = this.enter("label");
    let value = tracker.move("![");
    value += tracker.move(this.safe(node.alt, { before: value, after: "]" }));
    value += tracker.move("](");
    exitLabel();
    value += tracker.move(this.destination(node.url, value, node.title === undefined ? ")" : " "));
    if (node.title !== undefined) {
      value += tracker.move(this.title(node.title, value));
    }
    exit();
    return value + ")";
  }

  private linkReference(node: LinkReferenceNode, info: FormatInfo): string {
    const exit = this.enter("linkReference");
    const exitLabel = this.enter("label");
    const label = this.phrasing(node.children, { ...info, before: "[", after: "]" });
    exitLabel();
    const value = `[${label}]${this.referenceSuffix(node.referenceKind, node.identifier, label)}`;
    exit();
    return value;
  }

  private imageReference(node: ImageReferenceNode, _info: FormatInfo): string {
    const exit = this.enter("imageReference");
    const exitLabel = this.enter("label");
    const alt = this.safe(node.alt, { before: "![", after: "]" });
    exitLabel();
    const value = `![${alt}]${this.referenceSuffix(node.referenceKind, node.identifier, alt)}`;
    exit();
    return value;
  }

  private referenceSuffix(
    kind: LinkReferenceNode["referenceKind"],
    identifier: string,
    label: string,
  ): string {
    const reference = this.referenceIdentifier(identifier);
    if (label.length > 0 && normalizeIdentifier(label) === normalizeIdentifier(reference)) {
      if (kind === "shortcut") {
        return "";
      }
      if (kind === "collapsed") {
        return "[]";
      }
    }
    return `[${reference}]`;
  }

  private referenceIdentifier(identifier: string): string {
    return formatAssociationIdentifier(identifier);
  }

  private destination(value: string, before: string, after: string): string {
    if (value.length === 0 || /[\0- \u007F]/u.test(value)) {
      const exit = this.enter("destinationLiteral");
      const result = `<${this.safe(value, { before: `${before}<`, after: ">" })}>`;
      exit();
      return result;
    }
    const exit = this.enter("destinationRaw");
    const result = this.safe(value, { before, after });
    exit();
    return result;
  }

  private title(value: string, before: string): string {
    const quote = this.options.quote ?? '"';
    const exit = this.enter(quote === '"' ? "titleQuote" : "titleApostrophe");
    const result = ` ${quote}${this.safe(value, { before: `${before} ${quote}`, after: quote })}${quote}`;
    exit();
    return result;
  }

  private safe(value: string, info: FormatSafeInfo): string {
    return safeSource(this, value, info);
  }

  private enter(construct: FormatConstruct): () => void {
    this.stack.push(construct);
    return (): void => {
      this.stack.pop();
    };
  }
}

function tableDelimiter(alignment: TableNode["alignments"][number], width: number): string {
  if (alignment === "center") {
    return `:${"-".repeat(Math.max(1, width - 2))}:`;
  }
  if (alignment === "left") {
    return `:${"-".repeat(Math.max(2, width - 1))}`;
  }
  if (alignment === "right") {
    return `${"-".repeat(Math.max(2, width - 1))}:`;
  }
  return "-".repeat(width);
}

function serializeTableRow(
  values: readonly string[],
  widths: readonly number[],
  padding: boolean,
  measure: (value: string) => number,
): string {
  const cells = widths.map((width, index) => {
    const value = values[index] ?? "";
    const tail = " ".repeat(Math.max(0, width - measure(value)));
    return padding ? ` ${value}${tail} ` : `${value}${tail}`;
  });
  return `|${cells.join("|")}|`;
}

function peek(node: MdxNode, options: FormatOptions): string {
  if (node instanceof TextDirectiveNode) {
    return ":";
  }
  if (node instanceof InlineMathNode) {
    return node.format === "dollar" ? "$" : "\\";
  }
  if (node instanceof ImageNode || node instanceof ImageReferenceNode) {
    return "!";
  }
  if (node instanceof FootnoteReferenceNode) {
    return "[";
  }
  if (node instanceof LinkNode || node instanceof LinkReferenceNode) {
    return "[";
  }
  if (node instanceof EmphasisNode) {
    return options.emphasis ?? "*";
  }
  if (node instanceof StrongNode) {
    return options.strong ?? "*";
  }
  if (node instanceof DeleteNode) {
    return "~";
  }
  if (node instanceof InlineCodeNode) {
    return "`";
  }
  if (node instanceof RawHtmlInlineNode) {
    return "<";
  }
  if (node instanceof HardBreakNode) {
    return "\\";
  }
  if (node instanceof InlineExpressionNode) {
    return "{";
  }
  if (node instanceof JsxTextElementNode) {
    return "<";
  }
  if (node instanceof TextNode) {
    return node.value.charAt(0);
  }
  return "";
}

function indentExpression(value: string): string {
  return value.replace(/\r\n?|\n/gu, (ending) => `${ending}  `);
}

function escapeJsxAttribute(value: string, quote: '"' | "'"): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(quote, quote === '"' ? "&quot;" : "&#x27;");
}

function containsDirective(node: MdxNode): boolean {
  if (
    node instanceof TextDirectiveNode ||
    node instanceof LeafDirectiveNode ||
    node instanceof ContainerDirectiveNode
  ) {
    return true;
  }
  return node.children.some(containsDirective);
}

function mathFormats(node: MdxNode): ReadonlySet<MathFormat> {
  const formats = new Set<MathFormat>();
  collectMathFormats(node, formats);
  return formats;
}

function collectMathFormats(node: MdxNode, formats: Set<MathFormat>): void {
  if (node instanceof InlineMathNode || node instanceof DisplayMathNode) {
    formats.add(node.format);
  }
  for (const child of node.children) {
    collectMathFormats(child, formats);
  }
}

function containerDirectiveFenceSize(node: ContainerDirectiveNode): number {
  let nested = 0;
  for (const child of node.body) {
    for (const { node: directive } of selectTree<MdxNode, "containerDirective">(
      child,
      "containerDirective",
      (value) => value.children,
    )) {
      nested = Math.max(nested, containerDirectiveFenceSize(directive) - 2);
    }
  }
  return 3 + nested;
}

function formatDirectiveAttributes(
  entries: readonly { readonly name: string; readonly value: string }[],
  options: FormatOptions,
): string {
  if (entries.length === 0) {
    return "";
  }
  const shortcut = /^[^\t\n\r "#'.<=>`}]+$/u;
  const values: string[] = [];
  let id: string | undefined;
  const classes: string[] = [];
  const fullClasses: string[] = [];
  for (const entry of entries) {
    if (entry.name === "id" && shortcut.test(entry.value)) {
      id = `#${entry.value}`;
    } else if (entry.name === "class") {
      for (const className of entry.value.split(/[\t\n\r ]+/u)) {
        if (className.length === 0) {
          continue;
        }
        if (shortcut.test(className)) {
          classes.push(className);
        } else {
          fullClasses.push(className);
        }
      }
    } else {
      values.push(formatDirectiveAttribute(entry.name, entry.value, options));
    }
  }
  if (fullClasses.length > 0) {
    values.unshift(formatDirectiveAttribute("class", fullClasses.join(" "), options));
  }
  if (classes.length > 0) {
    values.unshift(`.${classes.join(".")}`);
  }
  if (id !== undefined) {
    values.unshift(id);
  }
  return `{${values.join(" ")}}`;
}

function formatDirectiveAttribute(name: string, value: string, options: FormatOptions): string {
  if (value.length === 0) {
    return name;
  }
  const quote = options.quote ?? '"';
  const encoded = value.replace(/[&\r\n"']/gu, (character) => {
    if (character === "&") {
      return "&amp;";
    }
    if (character === "\r") {
      return "&#xD;";
    }
    if (character === "\n") {
      return "&#xA;";
    }
    if (character === quote) {
      return quote === '"' ? "&quot;" : "&#x27;";
    }
    return character;
  });
  return `${name}=${quote}${encoded}${quote}`;
}

function formatInlineCode(input: string): string {
  const value = input.replace(/\r\n?|\n/gu, " ");
  let sequence = "`";
  while (new RegExp(`(^|[^\`])${sequence}([^\`]|$)`, "u").test(value)) {
    sequence += "`";
  }
  const padded =
    /[^ \r\n]/u.test(value) &&
    ((/^[ \r\n]/u.test(value) && /[ \r\n]$/u.test(value)) || /^`|`$/u.test(value))
      ? ` ${value} `
      : value;
  return `${sequence}${padded}${sequence}`;
}

function longestRun(value: string, marker: string): number {
  let longest = 0;
  let current = 0;
  for (const character of value) {
    current = character === marker ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

function alternateListMarker(marker: "*" | "+" | "-" | "." | ")"): "*" | "-" | "." | ")" {
  if (marker === ".") {
    return ")";
  }
  if (marker === ")") {
    return ".";
  }
  return marker === "*" ? "-" : "*";
}

function containsLineEnding(node: MdxNode): boolean {
  if (node instanceof HardBreakNode) {
    return true;
  }
  if (
    (node instanceof TextNode || node instanceof RawHtmlInlineNode) &&
    /\r\n?|\n/u.test(node.value)
  ) {
    return true;
  }
  return node.children.some(containsLineEnding);
}

function encodeBlankLineEndings(value: string): string {
  return value.replace(/(?:(?:\r\n?|\n)){2,}/gu, encodeLineEnding);
}

function encodeLineEnding(value: string): string {
  let result = "";
  for (const character of value) {
    result += encodeNumericCharacterReference(character.codePointAt(0) ?? 0);
  }
  return result;
}

function formatAssociationIdentifier(value: string): string {
  return value.replace(/[!-/:-@[-`{-~]/gu, "\\$&");
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/gu, "\\$&");
}

function indentLines(
  value: string,
  map: (line: string, blank: boolean, index: number) => string,
): string {
  return value
    .split(/\r\n?|\n/gu)
    .map((line, index) => map(line, line.length === 0, index))
    .join("\n");
}
