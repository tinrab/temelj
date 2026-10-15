import type { SourceText } from "../source-text.ts";
import type { ResolvedSyntaxOptions } from "../syntax-options.ts";
import type { InlineInput } from "./inline-input.ts";
import type { Bracket, Delimiter, InlineMatch, Output } from "./inline-output.ts";
import type { PendingCandidate } from "./inline-pending.ts";
import type {
  InlineParseResult,
  InlineResume,
  InlineSyntax,
  InvalidInlineSyntax,
} from "./inline-syntax.ts";

import { isAsciiPunctuation } from "./characters.ts";
import { matchLiteralAutolink } from "./inline-autolink.ts";
import { characterReference } from "./inline-character-reference.ts";
import { codeSpan } from "./inline-code.ts";
import { directiveUnfinished, inlineDirective } from "./inline-directive.ts";
import { angleNode, expressionNode } from "./inline-embedded.ts";
import { createDelimiter, resolveCloser } from "./inline-emphasis.ts";
import { resolveBracket } from "./inline-link.ts";
import { dollarMath, dollarUnclosed, texMath } from "./inline-math.ts";
import { convertOutput, markerRunEnd, textNode } from "./inline-output.ts";
import { pendingInline } from "./inline-pending.ts";

/** The parser state at a safe point, behind the opaque `InlineResume` type. */
interface ResumeState {
  readonly offset: number;
  readonly textStart: number;
  readonly prefix: string;
  /** The input the state came from. */
  readonly input: InlineInput;
  /**
   * The parse's own output and delimiter arrays with their lengths at the safe
   * point. Entries before a safe point never change, so the next parse takes
   * the arrays over and truncates them instead of copying.
   */
  readonly output: Output[];
  readonly outputLength: number;
  readonly delimiters: Delimiter[];
  readonly delimitersLength: number;
  readonly invalid: readonly InvalidInlineSyntax[];
  readonly references: readonly string[];
  readonly footnotes: readonly string[];
  /** `output` as nodes, which resumed parses extend in place to keep node identities. */
  readonly nodes: InlineSyntax[];
  readonly nodesLength: number;
}

interface SafePoint {
  readonly offset: number;
  readonly textStart: number;
  readonly output: number;
  readonly delimiters: number;
  readonly invalid: number;
  readonly references: number;
  readonly footnotes: number;
}

const resumeStates = new WeakMap<InlineResume, ResumeState>();

/**
 * Direct inline parser with one output sequence and one delimiter stack.
 * Closers resolve as they arrive, so at a line start with no open delimiter,
 * bracket, or unfinished construct, the output so far is final. The result
 * keeps the last such safe point; passing it back parses only the text after
 * it, when the input still starts with the same text.
 */
export function parseInline(
  input: InlineInput,
  syntax: ResolvedSyntaxOptions,
  resume?: InlineResume,
): InlineParseResult {
  const value = input.text();
  const saved = resume === undefined ? undefined : resumeStates.get(resume);

  // An input built by extending the saved one shares its text, so only other inputs are compared.
  const resumed =
    saved !== undefined && (input.extends(saved.input) || value.startsWith(saved.prefix))
      ? saved
      : undefined;

  const scan = new InlineScan(input, value, syntax, resumed);
  scan.run();

  return scan.result(resume);
}

/** One inline parse: the output sequence, the delimiter and bracket stacks, and the cursor. */
class InlineScan {
  readonly #input: InlineInput;
  readonly #value: SourceText;
  readonly #syntax: ResolvedSyntaxOptions;
  readonly #resumed: ResumeState | undefined;
  readonly #output: Output[];
  readonly #delimiters: Delimiter[];
  readonly #brackets: Bracket[] = [];
  readonly #invalid: InvalidInlineSyntax[];
  readonly #references: Set<string>;
  readonly #footnotes: Set<string>;
  #openEmbedded: PendingCandidate | undefined;
  #textStart: number;
  #offset: number;
  #safe: SafePoint | undefined;
  /** A construct that failed only because input ended may still close, changing earlier output. */
  #stable = true;

  public constructor(
    input: InlineInput,
    value: SourceText,
    syntax: ResolvedSyntaxOptions,
    resumed: ResumeState | undefined,
  ) {
    this.#input = input;
    this.#value = value;
    this.#syntax = syntax;
    this.#resumed = resumed;
    this.#output = resumed === undefined ? [] : resumed.output;
    this.#delimiters = resumed === undefined ? [] : resumed.delimiters;
    this.#output.length = resumed?.outputLength ?? 0;
    this.#delimiters.length = resumed?.delimitersLength ?? 0;
    this.#invalid = resumed === undefined ? [] : [...resumed.invalid];
    this.#references = new Set(resumed?.references);
    this.#footnotes = new Set(resumed?.footnotes);
    this.#textStart = resumed?.textStart ?? 0;
    this.#offset = resumed?.offset ?? 0;
  }

  public run(): void {
    while (this.#offset < this.#value.length) {
      this.recordSafePoint();

      if (!this.scanConstruct(this.#value.char(this.#offset) ?? "")) {
        this.#offset++;
      }
    }

    // Input that ends with a line ending can resume after it.
    this.recordSafePoint();
    this.flushText(this.#value.length);
  }

  public result(resume: InlineResume | undefined): InlineParseResult {
    const input = this.#input;
    const output = this.#output;
    const resumed = this.#resumed;
    const resumedLength = resumed?.outputLength ?? 0;
    const safe = this.#safe;

    const pending = pendingInline(
      input,
      this.#value,
      output,
      this.#openEmbedded,
      this.#syntax,
      resumed?.offset ?? 0,
      resumedLength,
    );

    let nodes: InlineSyntax[];
    let stateNodes: InlineSyntax[] | undefined;
    let stateLength = 0;

    if (resumed === undefined) {
      nodes = convertOutput(input, output);

      if (safe !== undefined) {
        stateNodes = convertOutput(input, output.slice(0, safe.output));
        stateLength = stateNodes.length;
      }
    } else {
      // A resumed parse extends the chain's node array in place. Text is not merged across safe
      // points, so every node before the last one keeps its identity for later parses.
      nodes = resumed.nodes;
      nodes.length = resumed.nodesLength;
      const end = safe?.output ?? resumedLength;
      nodes.push(...convertOutput(input, output.slice(resumedLength, end)));
      stateNodes = nodes;
      stateLength = nodes.length;
      nodes.push(...convertOutput(input, output.slice(end)));
    }

    let next = resume;

    if (safe !== undefined && stateNodes !== undefined) {
      const state: ResumeState = {
        offset: safe.offset,
        textStart: safe.textStart,
        prefix: this.#value.slice(0, safe.offset),
        input,
        output,
        outputLength: safe.output,
        delimiters: this.#delimiters,
        delimitersLength: safe.delimiters,
        invalid: this.#invalid.slice(0, safe.invalid),
        references: [...this.#references].slice(0, safe.references),
        footnotes: [...this.#footnotes].slice(0, safe.footnotes),
        nodes: stateNodes,
        nodesLength: stateLength,
      };

      next = Object.freeze({});
      resumeStates.set(next, state);
    }

    return {
      nodes,
      invalid: this.#invalid,
      references: this.#references,
      footnotes: this.#footnotes,
      pending,
      resume: next,
    };
  }

  /** Consumes the construct at the cursor, in CommonMark precedence order. */
  private scanConstruct(character: string): boolean {
    return (
      this.scanDirective(character) ||
      this.scanTexMath(character) ||
      this.scanDollarMath(character) ||
      this.scanSpaceBreak(character) ||
      this.scanAutolink() ||
      this.scanOpenBracket(character) ||
      this.scanCloseBracket(character) ||
      this.scanBackslash(character) ||
      this.scanCodeSpan(character) ||
      this.scanCharacterReference(character) ||
      this.scanExpression(character) ||
      this.scanAngle(character) ||
      this.scanDelimiterRun(character)
    );
  }

  /**
   * Closers resolve as they arrive, so at a line start with no open delimiter,
   * bracket, or unfinished construct, the output so far is final.
   */
  private recordSafePoint(): void {
    if (
      this.#stable &&
      this.#offset > (this.#resumed?.offset ?? 0) &&
      startsLine(this.#value, this.#offset) &&
      this.#brackets.length === 0 &&
      this.#openEmbedded === undefined &&
      !this.#delimiters.some((delimiter) => delimiter.canOpen)
    ) {
      this.#safe = {
        offset: this.#offset,
        textStart: this.#textStart,
        output: this.#output.length,
        delimiters: this.#delimiters.length,
        invalid: this.#invalid.length,
        references: this.#references.size,
        footnotes: this.#footnotes.size,
      };
    }
  }

  private scanDirective(character: string): boolean {
    if (character !== ":" || !this.#syntax.directives) {
      return false;
    }

    const directive = inlineDirective(this.#input, this.#value, this.#offset);
    this.#stable &&= directive !== undefined || !directiveUnfinished(this.#value, this.#offset);

    return directive !== undefined && this.emit(directive);
  }

  private scanTexMath(character: string): boolean {
    if (
      character !== "\\" ||
      this.#value.char(this.#offset + 1) !== "(" ||
      !this.#syntax.math.includes("tex")
    ) {
      return false;
    }

    const math = texMath(this.#input, this.#value, this.#offset);
    this.#stable &&= math !== undefined;

    return math !== undefined && this.emit(math);
  }

  private scanDollarMath(character: string): boolean {
    if (character !== "$" || !this.#syntax.math.includes("dollar")) {
      return false;
    }

    const math = dollarMath(this.#input, this.#value, this.#offset);
    this.#stable &&= math !== undefined || !dollarUnclosed(this.#value, this.#offset);

    return math !== undefined && this.emit(math);
  }

  /** Two or more spaces before a line ending make a hard break. */
  private scanSpaceBreak(character: string): boolean {
    if (character !== "\n" && character !== "\r") {
      return false;
    }

    const value = this.#value;
    let spaces = this.#offset;

    while (spaces > this.#textStart && value.char(spaces - 1) === " ") {
      spaces--;
    }

    if (this.#offset - spaces < 2) {
      return false;
    }

    this.flushText(spaces);

    const end =
      character === "\r" && value.char(this.#offset + 1) === "\n"
        ? this.#offset + 2
        : this.#offset + 1;

    this.#output.push({ kind: "hardBreak", range: this.#input.sourceRange(spaces, end) });

    return this.advance(end);
  }

  private scanAutolink(): boolean {
    const autolink = matchLiteralAutolink(this.#input, this.#value, this.#offset);

    return autolink !== undefined && this.emit(autolink);
  }

  private scanOpenBracket(character: string): boolean {
    const image = character === "!" && this.#value.char(this.#offset + 1) === "[";

    if (character !== "[" && !image) {
      return false;
    }

    this.flushText(this.#offset);
    const bracket: Bracket = { active: true, image, start: this.#offset };
    this.#output.push(bracket);
    this.#brackets.push(bracket);

    return this.advance(this.#offset + (image ? 2 : 1));
  }

  private scanCloseBracket(character: string): boolean {
    const bracket = character === "]" ? this.#brackets.at(-1) : undefined;

    if (bracket === undefined) {
      return false;
    }

    this.flushText(this.#offset);
    this.#brackets.pop();

    const resolved = resolveBracket(
      this.#input,
      this.#value,
      this.#offset,
      bracket,
      this.#output,
      this.#delimiters,
      this.#references,
      this.#footnotes,
    );

    this.#stable &&= resolved !== undefined;

    if (resolved === undefined) {
      this.#output.push(textNode(this.#input, this.#value, this.#offset, this.#offset + 1));

      return this.advance(this.#offset + 1);
    }

    // Links cannot contain links, so a link deactivates the open link brackets around it.
    if (!bracket.image) {
      for (const opener of this.#brackets) {
        if (!opener.image) {
          opener.active = false;
        }
      }
    }

    return this.advance(resolved);
  }

  /** A backslash before a line ending is a hard break; before punctuation, an escape. */
  private scanBackslash(character: string): boolean {
    if (character !== "\\") {
      return false;
    }

    const next = this.#value.char(this.#offset + 1);

    if (next === "\n" || next === "\r") {
      this.flushText(this.#offset);

      const end =
        next === "\r" && this.#value.char(this.#offset + 2) === "\n"
          ? this.#offset + 3
          : this.#offset + 2;

      this.#output.push({ kind: "hardBreak", range: this.#input.sourceRange(this.#offset, end) });

      return this.advance(end);
    }

    if (next === undefined || !isAsciiPunctuation(next)) {
      return false;
    }

    this.flushText(this.#offset);
    this.#output.push(textNode(this.#input, this.#value, this.#offset + 1, this.#offset + 2));

    return this.advance(this.#offset + 2);
  }

  private scanCodeSpan(character: string): boolean {
    if (character !== "`") {
      return false;
    }

    const code = codeSpan(this.#input, this.#value, this.#offset);
    this.#stable &&= code !== undefined;

    return code !== undefined && this.emit(code);
  }

  private scanCharacterReference(character: string): boolean {
    if (character !== "&") {
      return false;
    }

    const reference = characterReference(this.#input, this.#value, this.#offset);

    return reference !== undefined && this.emit(reference);
  }

  private scanExpression(character: string): boolean {
    const expression =
      character === "{" ? expressionNode(this.#input, this.#value, this.#offset) : undefined;

    if (expression === undefined) {
      return false;
    }

    const range = this.#input.sourceRange(this.#offset, expression.end);
    this.flushText(this.#offset);
    this.#stable &&= !expression.open;

    if (expression.node === undefined) {
      this.#invalid.push({ range, syntax: "expression", open: expression.open });

      if (expression.open) {
        this.#openEmbedded = { start: this.#offset, pending: { kind: "expression", range } };
      }

      this.#output.push(textNode(this.#input, this.#value, this.#offset, expression.end));
    } else {
      this.#output.push(expression.node);
    }

    return this.advance(expression.end);
  }

  private scanAngle(character: string): boolean {
    const angle = character === "<" ? angleNode(this.#input, this.#value, this.#offset) : undefined;

    if (angle === undefined) {
      return false;
    }

    const range = this.#input.sourceRange(this.#offset, angle.end);
    this.flushText(this.#offset);
    this.#stable &&= !angle.open;

    if (angle.invalid) {
      this.#invalid.push({ range, syntax: "jsx", open: angle.open });

      if (angle.open) {
        this.#openEmbedded = { start: this.#offset, pending: { kind: "jsx", range } };
      }
    }

    this.#output.push(angle.node);

    return this.advance(angle.end);
  }

  private scanDelimiterRun(character: string): boolean {
    if (character !== "*" && character !== "_" && character !== "~") {
      return false;
    }

    const runEnd = markerRunEnd(this.#value, this.#offset, character);

    if (character === "~" && runEnd - this.#offset < (this.#syntax.singleTilde ? 1 : 2)) {
      return false;
    }

    this.flushText(this.#offset);
    const delimiter = createDelimiter(this.#value, this.#offset, runEnd, character);
    this.#output.push(delimiter);
    this.#delimiters.push(delimiter);
    resolveCloser(this.#input, this.#output, this.#delimiters, delimiter, this.#syntax);

    return this.advance(runEnd);
  }

  /** Appends a matched construct and moves the cursor after it. */
  private emit(match: InlineMatch): true {
    this.flushText(this.#offset);
    this.#output.push(match.node);

    return this.advance(match.end);
  }

  private advance(end: number): true {
    this.#offset = end;
    this.#textStart = end;

    return true;
  }

  private flushText(end: number): void {
    if (end > this.#textStart) {
      this.#output.push(textNode(this.#input, this.#value, this.#textStart, end));
    }

    this.#textStart = end;
  }
}

/** Text that a line ending precedes. */
function startsLine(value: SourceText, offset: number): boolean {
  const previous = value.char(offset - 1);

  return previous === "\n" || (previous === "\r" && value.char(offset) !== "\n");
}
