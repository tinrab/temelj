import type {
  BlockQuoteNode,
  CodeBlockNode,
  DefinitionNode,
  FootnoteDefinitionNode,
  FootnoteReferenceNode,
  HeadingNode,
  ImageNode,
  ImageReferenceNode,
  LinkNode,
  LinkReferenceNode,
  ListItemNode,
  ListNode,
  MdxNode,
  ParagraphNode,
} from "./model.ts";

import { encodeNumericCharacterReference } from "./character-reference.ts";
import {
  indentLines,
  longestRun,
  rootInfo,
  type FormatContext,
  type FormatInfo,
  type FormatOptions,
} from "./format-context.ts";
import {
  formatContainerDirective,
  formatDirective,
  formatDirectiveLabel,
  containsDirective,
} from "./format-directive.ts";
import { formatJsxFlowElement, formatJsxTextElement, indentExpression } from "./format-jsx.ts";
import { formatDisplayMath, formatInlineMath, mathFormats } from "./format-math.ts";
import {
  unsafePatterns,
  compileUnsafePattern,
  safeSource,
  type FormatConstruct,
  type FormatSafeInfo,
  type FormatSafetyState,
  type FormatUnsafePattern,
} from "./format-safe.ts";
import { formatTable, formatTableCell, formatTableRow } from "./format-table.ts";
import { createFormatTracker } from "./format-track.ts";
import { normalizeIdentifier } from "./identifier.ts";
import { mdxChildren } from "./model.ts";
import {
  frontmatterFence,
  resolveSyntaxOptions,
  type MathFormat,
  type ResolvedSyntaxOptions,
} from "./syntax-options.ts";

/** Formats a node as canonical MDX for the enabled syntax. */
export function formatMdx(node: MdxNode, options: FormatOptions = {}): string {
  return new Formatter(options, containsDirective(node), mathFormats(node)).format(node, rootInfo);
}

class Formatter implements FormatSafetyState, FormatContext {
  public readonly stack: FormatConstruct[] = [];
  public readonly unsafe: readonly FormatUnsafePattern[];
  private readonly compiledPatterns = new Map<FormatUnsafePattern, RegExp>();
  public readonly options: FormatOptions;
  public readonly syntax: ResolvedSyntaxOptions;
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
        return formatTable(this, node, info);
      case "tableRow":
        return formatTableRow(this, node, info);
      case "tableCell":
        return formatTableCell(this, node, info);
      case "definition":
        return this.definition(node, info);
      case "footnoteDefinition":
        return this.footnoteDefinition(node, info);
      case "frontmatter":
        return `${frontmatterFence(node.format)}${node.value.length === 0 ? "" : `\n${node.value}`}\n${frontmatterFence(node.format)}`;
      case "directiveLabel":
        return formatDirectiveLabel(this, node, info);
      case "textDirective":
        return formatDirective(this, node, info, ":");
      case "leafDirective":
        return formatDirective(this, node, info, "::");
      case "containerDirective":
        return formatContainerDirective(this, node, info);
      case "displayMath":
        return formatDisplayMath(this, node, info);
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
        return formatInlineMath(this, node);
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
      case "jsxTextElement":
        return formatJsxTextElement(this, node, info);
      case "jsxFlowElement":
        return formatJsxFlowElement(this, node, info);
      default: {
        const exhaustive: never = node;

        return exhaustive;
      }
    }
  }

  public flow(nodes: readonly MdxNode[], info: FormatInfo, spread?: boolean): string {
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

      if (node.kind !== "list") {
        this.bulletLastUsed = undefined;
      }
    }

    return output.join("");
  }

  private join(left: MdxNode, right: MdxNode, spread?: boolean): string {
    if (
      this.options.tightDefinitions === true &&
      left.kind === "definition" &&
      right.kind === "definition"
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

  public phrasing(nodes: readonly MdxNode[], info: FormatInfo): string {
    let tracker = createFormatTracker(info);
    const output: string[] = [];
    let before = info.before;

    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      let nextIndex = index + 1;
      let text = node.kind === "text" ? node.value : undefined;
      let nextText = nodes.at(nextIndex);

      while (text !== undefined && nextText?.kind === "text") {
        text += nextText.value;
        nextIndex++;
        nextText = nodes.at(nextIndex);
      }

      const next = nodes[nextIndex];
      const after = next === undefined ? info.after : peek(next, this.options);

      if (
        output.length > 0 &&
        (before === "\r" || before === "\n") &&
        node.kind === "rawHtmlInline"
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
        node.children.some((item) => item.children[0]?.kind === "thematicBreak"))
    ) {
      marker = alternateListMarker(marker);
    }

    const values = node.children.map((item, index) =>
      this.listItem(item, node, index, marker, info),
    );

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

    if (item.checked !== undefined && item.children[0]?.kind === "paragraph") {
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

  public safe(value: string, info: FormatSafeInfo): string {
    return safeSource(this, value, info);
  }

  public enter(construct: FormatConstruct): () => void {
    this.stack.push(construct);

    return (): void => {
      this.stack.pop();
    };
  }
}

function peek(node: MdxNode, options: FormatOptions): string {
  switch (node.kind) {
    case "textDirective":
      return ":";
    case "inlineMath":
      return node.format === "dollar" ? "$" : "\\";
    case "image":
    case "imageReference":
      return "!";
    case "footnoteReference":
    case "link":
    case "linkReference":
      return "[";
    case "emphasis":
      return options.emphasis ?? "*";
    case "strong":
      return options.strong ?? "*";
    case "delete":
      return "~";
    case "inlineCode":
      return "`";
    case "rawHtmlInline":
    case "jsxTextElement":
      return "<";
    case "hardBreak":
      return "\\";
    case "inlineExpression":
      return "{";
    case "text":
      return node.value.charAt(0);
    default:
      return "";
  }
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
  if (node.kind === "hardBreak") {
    return true;
  }

  if ((node.kind === "text" || node.kind === "rawHtmlInline") && /\r\n?|\n/u.test(node.value)) {
    return true;
  }

  return mdxChildren(node).some(containsLineEnding);
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
