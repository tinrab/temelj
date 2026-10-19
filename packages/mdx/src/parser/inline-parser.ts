import type { SourceText } from "../source-text.ts";
import type { ResolvedSyntaxOptions } from "../syntax-options.ts";
import type { InlineInput } from "./inline-input.ts";
import type { Bracket, Delimiter, InlineMatch, Output } from "./inline-output.ts";
import type { PendingCandidate } from "./inline-pending.ts";
import type {
  DefinitionLookup,
  InlineParseResult,
  InlineSyntax,
  InvalidInlineSyntax,
} from "./inline-syntax.ts";

import { isAsciiPunctuation } from "./characters.ts";
import { matchLiteralAutolink } from "./inline-autolink.ts";
import { characterReference } from "./inline-character-reference.ts";
import { codeSpan } from "./inline-code.ts";
import { directiveUnfinished, inlineDirective } from "./inline-directive.ts";
import { angleNode, expressionNode } from "./inline-embedded.ts";
import { createDelimiter, resolveCloser, resolveDelimiters } from "./inline-emphasis.ts";
import { resolveBracket } from "./inline-link.ts";
import { dollarMath, dollarUnclosed, texMath } from "./inline-math.ts";
import { convertOutput, markerRunEnd, textNode } from "./inline-output.ts";
import { pendingInline } from "./inline-pending.ts";

/** Private arrays retained before the suffix that future input can still change. */
interface ResumeState {
  readonly offset: number;
  readonly textStart: number;
  /** The input the state came from. */
  readonly input: InlineInput;
  /**
   * The parse's own output array with its length at the safe
   * point. Entries before a safe point never change, so the next parse takes
   * the arrays over and truncates them instead of copying.
   */
  readonly output: Output[];
  readonly outputLength: number;
  readonly invalid: readonly InvalidInlineSyntax[];
  readonly references: readonly string[];
  /** `output` as nodes, which resumed parses extend in place to keep node identities. */
  readonly nodes: InlineSyntax[];
  readonly nodesLength: number;
  readonly lastNode: InlineSyntax | undefined;
}

interface SafePoint {
  readonly offset: number;
  readonly textStart: number;
  readonly output: number;
  readonly invalid: number;
  readonly references: number;
}

/** A paragraph owns its continuation; edits start a new parse. */
export class InlineParser {
  readonly #syntax: ResolvedSyntaxOptions;
  #state: ResumeState | undefined;
  #definitions: DefinitionLookup = emptyDefinitions;

  public constructor(syntax: ResolvedSyntaxOptions) {
    this.#syntax = syntax;
  }

  public parse(
    input: InlineInput,
    definitions: DefinitionLookup = emptyDefinitions,
  ): InlineParseResult {
    const previous = this.#state;

    const stable =
      previous === undefined ||
      definitions === this.#definitions ||
      previous.references.every((id) => definitions.has(id) === this.#definitions.has(id));

    const state = stable ? previous : undefined;
    this.#definitions = definitions;
    const resumed = state !== undefined && input.extends(state.input) ? state : undefined;
    const scan = new InlineScan(input, this.#syntax, resumed, true, definitions);
    const parsed = scan.run();
    this.#state = scan.state;

    return parsed;
  }
}

/** Complete input uses the same grammar without retaining preview state. */
export function parseInline(
  input: InlineInput,
  syntax: ResolvedSyntaxOptions,
  definitions: DefinitionLookup = emptyDefinitions,
): InlineParseResult {
  return new InlineScan(input, syntax, undefined, false, definitions).run();
}

const emptyDefinitions: DefinitionLookup = new Set<string>();

const INLINE_MARKERS = /[\\\r\n \t![\]`&{<_*~:$hHwW]/gu;

const EMAIL_MARKERS = /[\\\r\n \t![\]`&{<_*~:$A-Za-z\d.+-]/gu;

/** One inline parse: the output sequence, the delimiter and bracket stacks, and the cursor. */
class InlineScan {
  public state: ResumeState | undefined;
  readonly #input: InlineInput;
  readonly #value: SourceText;
  readonly #syntax: ResolvedSyntaxOptions;
  readonly #resumed: ResumeState | undefined;
  readonly #preview: boolean;
  readonly #emailAutolinks: boolean;
  readonly #output: Output[];
  readonly #delimiters: Delimiter[] = [];
  readonly #brackets: Bracket[] = [];
  readonly #invalid: InvalidInlineSyntax[];
  readonly #definitions: DefinitionLookup;
  readonly #references: Set<string>;
  #openEmbedded: PendingCandidate | undefined;
  #textStart: number;
  #offset: number;
  #safe: SafePoint | undefined;
  /** A construct that failed only because input ended may still close, changing earlier output. */
  #stable = true;

  public constructor(
    input: InlineInput,
    syntax: ResolvedSyntaxOptions,
    resumed: ResumeState | undefined,
    preview: boolean,
    definitions: DefinitionLookup,
  ) {
    const value = input.text();
    this.#input = input;
    this.#value = value;
    this.#syntax = syntax;
    this.#resumed = resumed;
    this.#preview = preview;
    this.#definitions = definitions;
    this.#references = new Set(resumed?.references);
    this.#output = resumed === undefined ? [] : resumed.output;
    this.#output.length = resumed?.outputLength ?? 0;
    this.#invalid = resumed === undefined ? [] : [...resumed.invalid];
    this.#textStart = resumed?.textStart ?? 0;
    this.#offset = resumed?.offset ?? 0;
    this.#emailAutolinks = value.indexOf("@", this.#offset) !== -1;
  }

  public run(): InlineParseResult {
    while (this.#offset < this.#value.length) {
      const character = this.#value.char(this.#offset) ?? "";

      if (this.#preview) {
        this.recordSafePoint(character);
      }

      if (!this.scanConstruct(character)) {
        this.#offset = this.#value.findCharacter(
          this.#emailAutolinks ? EMAIL_MARKERS : INLINE_MARKERS,
          this.#offset + 1,
        );
      }
    }

    // Input that ends with a line ending can resume after it.
    if (this.#preview) {
      this.recordSafePoint();
    }

    this.flushText(this.#value.length);
    resolveDelimiters(this.#input, this.#output, this.#delimiters, this.#syntax);

    return this.result();
  }

  private result(): InlineParseResult {
    const input = this.#input;
    const output = this.#output;
    const resumed = this.#resumed;
    const resumedLength = resumed?.outputLength ?? 0;

    const unsettled = this.#preview
      ? pendingInline(
          input,
          this.#value,
          output,
          this.#openEmbedded,
          this.#syntax,
          resumed?.offset ?? 0,
          resumedLength,
          this.#safe?.offset,
        )
      : undefined;

    const pending = unsettled?.pending;
    let safe = this.#safe;

    // Raw pending syntax can start inside a construct consumed by the grammar.
    // Keep that candidate in the retry region rather than skipping it next time.
    if (safe !== undefined && unsettled !== undefined && unsettled.earliest < safe.offset) {
      safe = undefined;
    }

    const nodes = resumed?.nodes ?? [];
    let changedFrom = resumed?.nodesLength ?? 0;

    if (resumed !== undefined) {
      nodes.length = resumed.nodesLength;

      if (resumed.lastNode !== undefined) {
        nodes[nodes.length - 1] = resumed.lastNode;

        if (resumed.lastNode.kind === "text") {
          changedFrom--;
        }
      }
    }

    const end = safe?.output ?? resumedLength;

    if (end > resumedLength) {
      convertOutput(input, output.slice(resumedLength, end), nodes);
    }

    this.state =
      safe === undefined
        ? resumed
        : {
            offset: safe.offset,
            textStart: safe.textStart,
            input,
            output,
            outputLength: safe.output,
            invalid: this.#invalid.slice(0, safe.invalid),
            references: [...this.#references].slice(0, safe.references),
            nodes,
            nodesLength: nodes.length,
            lastNode: nodes.at(-1),
          };

    convertOutput(input, end === 0 ? output : output.slice(end), nodes);

    return {
      nodes,
      invalid: this.#invalid,
      pending,
      changedFrom,
      references: [...this.#references],
    };
  }

  /** Consumes the construct at the cursor, in CommonMark precedence order. */
  private scanConstruct(character: string): boolean {
    switch (character) {
      case ":":
        return this.scanDirective();
      case "\\":
        return this.scanTexMath() || this.scanBackslash();
      case "$":
        return this.scanDollarMath();
      case "\n":
      case "\r":
        return this.scanSpaceBreak(character);
      case "!":
      case "[":
        return this.scanOpenBracket(character);
      case "]":
        return this.scanCloseBracket();
      case "`":
        return this.scanCodeSpan();
      case "&":
        return this.scanCharacterReference();
      case "{":
        return this.scanExpression();
      case "<":
        return this.scanAngle();
      case "_":
        return this.scanAutolink(character) || this.scanDelimiterRun(character);
      case "*":
      case "~":
        return this.scanDelimiterRun(character);
      default:
        return this.scanAutolink(character);
    }
  }

  /** Known whitespace ends a token; open constructs keep their earlier retry point. */
  private recordSafePoint(character?: string): void {
    const previous = this.#value.char(this.#offset - 1);

    if (
      this.#stable &&
      this.#offset > (this.#resumed?.offset ?? 0) &&
      (character === " " ||
        character === "\t" ||
        previous === "\n" ||
        (previous === "\r" && character !== "\n")) &&
      this.#brackets.length === 0 &&
      !this.#delimiters.some((delimiter) => delimiter.canOpen)
    ) {
      this.#safe = {
        offset: this.#offset,
        textStart: this.#textStart,
        output: this.#output.length,
        invalid: this.#invalid.length,
        references: this.#references.size,
      };
    }
  }

  private scanDirective(): boolean {
    if (!this.#syntax.directives) {
      return false;
    }

    const directive = inlineDirective(this.#input, this.#value, this.#offset);
    this.#stable &&= directive !== undefined || !directiveUnfinished(this.#value, this.#offset);

    return directive !== undefined && this.emit(directive);
  }

  private scanTexMath(): boolean {
    if (this.#value.char(this.#offset + 1) !== "(" || !this.#syntax.math.includes("tex")) {
      return false;
    }

    const math = texMath(this.#input, this.#value, this.#offset);
    this.#stable &&= math !== undefined;

    return math !== undefined && this.emit(math);
  }

  private scanDollarMath(): boolean {
    if (!this.#syntax.math.includes("dollar")) {
      return false;
    }

    const math = dollarMath(this.#input, this.#value, this.#offset);
    this.#stable &&= math !== undefined || !dollarUnclosed(this.#value, this.#offset);

    return math !== undefined && this.emit(math);
  }

  /** Two or more spaces before a line ending make a hard break. */
  private scanSpaceBreak(character: "\n" | "\r"): boolean {
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

  private scanAutolink(character: string): boolean {
    if (this.#brackets.length > 0) {
      return false;
    }

    // Without an @, only HTTP and www prefixes can start a literal link.
    if (!this.#emailAutolinks && !"hHwW".includes(character)) {
      return false;
    }

    const autolink = matchLiteralAutolink(this.#input, this.#value, this.#offset);

    return autolink !== undefined && this.emit(autolink);
  }

  private scanOpenBracket(character: "!" | "["): boolean {
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

  private scanCloseBracket(): boolean {
    const bracket = this.#brackets.at(-1);

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
      this.#syntax,
      this.#definitions,
      this.#references,
      this.#brackets.length > 0,
    );

    this.#stable &&= resolved !== undefined;

    if (resolved === undefined) {
      this.#output.push(textNode(this.#input, this.#value, this.#offset, this.#offset + 1));

      return this.advance(this.#offset + 1);
    }

    // Links cannot contain links, so a link deactivates the open link brackets around it.
    if (resolved.link) {
      for (const opener of this.#brackets) {
        if (!opener.image) {
          opener.active = false;
        }
      }
    }

    return this.advance(resolved.end);
  }

  /** A backslash before a line ending is a hard break; before punctuation, an escape. */
  private scanBackslash(): boolean {
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

  private scanCodeSpan(): boolean {
    const code = codeSpan(this.#input, this.#value, this.#offset);
    this.#stable &&= code !== undefined;

    return code !== undefined && this.emit(code);
  }

  private scanCharacterReference(): boolean {
    const reference = characterReference(this.#input, this.#value, this.#offset);

    return reference !== undefined && this.emit(reference);
  }

  private scanExpression(): boolean {
    const expression = expressionNode(this.#input, this.#value, this.#offset);

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

  private scanAngle(): boolean {
    const angle = angleNode(this.#input, this.#value, this.#offset);

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

  private scanDelimiterRun(character: "*" | "_" | "~"): boolean {
    const runEnd = markerRunEnd(this.#value, this.#offset, character);

    if (character === "~" && runEnd - this.#offset < (this.#syntax.singleTilde ? 1 : 2)) {
      return false;
    }

    this.flushText(this.#offset);
    const delimiter = createDelimiter(this.#value, this.#offset, runEnd, character);
    this.#output.push(delimiter);
    this.#delimiters.push(delimiter);
    resolveCloser(
      this.#input,
      this.#output,
      this.#delimiters,
      delimiter,
      this.#syntax,
      this.#brackets.at(-1)?.start ?? -1,
    );

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
