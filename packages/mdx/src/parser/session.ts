import type { PhysicalLine } from "../source.ts";
import type { BlockParserCheckpoint, SettledBlockListener } from "./block-parser.ts";
import type { BlockSyntax } from "./block-syntax.ts";
import type { PendingBlockSyntax } from "./block-syntax.ts";
import type { ParserLimits, ResolvedParserLimits } from "./config.ts";

import { InputError } from "../errors.ts";
import { SourceText } from "../source-text.ts";
import { PhysicalLineScanner, SourceFile, sourceText } from "../source.ts";
import {
  resolveSyntaxOptions,
  type ResolvedSyntaxOptions,
  type SyntaxOptions,
} from "../syntax-options.ts";
import { BlockParser } from "./block-parser.ts";
import { resolveParserLimits } from "./config.ts";

export interface ParserSessionOptions {
  readonly limits?: ParserLimits;
  readonly source?: string | SourceFile;
  readonly syntax?: SyntaxOptions;
  /**
   * Receives each top-level block once it settles. After an edit, blocks settle
   * again from the first changed index.
   */
  readonly onSettled?: SettledBlockListener;
}

export interface ParserDraftSnapshot {
  readonly file: SourceFile;
  readonly blocks: readonly BlockSyntax[];
}

/** The unsettled top-level blocks, finished as if the source ended here. */
export interface ParserTailDraft {
  readonly blocks: readonly BlockSyntax[];
  /** The leaf that was still open, which later input may extend. */
  readonly pending?: PendingBlockSyntax;
}

export interface ParserSessionEdit {
  readonly end: number;
  readonly start: number;
  readonly text: string;
}

interface SessionCheckpoint {
  readonly line: number;
  readonly offset: number;
  readonly parser: BlockParserCheckpoint;
}

/** Retained direct-parser state shared by batch and streaming entry points. */
export class ParserSession {
  #blockParser: BlockParser;
  #checkpoints: SessionCheckpoint[];
  #lineScanner: PhysicalLineScanner;
  readonly limits: ResolvedParserLimits;
  readonly syntax: ResolvedSyntaxOptions;
  #complete = false;
  #grammarSource = SourceText.of("");
  /** The source has no NUL, so its grammar source is the same text. */
  #plain = true;
  #name = "source.mdx";
  #source = SourceText.of("");

  public constructor(options: ParserSessionOptions = {}) {
    this.limits = resolveParserLimits(options.limits);
    this.syntax = resolveSyntaxOptions(options.syntax);
    this.#blockParser = new BlockParser(this.syntax, [], options.onSettled);
    this.#lineScanner = new PhysicalLineScanner();
    this.#checkpoints = [{ line: 1, offset: 0, parser: { length: 0, tail: undefined } }];

    if (options.source instanceof SourceFile) {
      this.#name = options.source.name;
    }

    const source =
      options.source instanceof SourceFile ? options.source.text : (options.source ?? "");

    if (source !== "") {
      this.append(
        source,
        options.source instanceof SourceFile ? sourceText(options.source) : undefined,
      );
    }
  }

  /** The number of top-level blocks that later input cannot change. */
  public get settledCount(): number {
    return this.#blockParser.settledCount;
  }

  /** `source` is the whole source after the append, when the caller already built it. */
  public append(text: string, source?: SourceText): void {
    if (this.#complete) {
      throw new Error("Cannot append to a completed parser session");
    }

    this.#source = source ?? this.#source.append(text);
    this.#plain &&= !text.includes("\0");

    // Without NUL the grammar source is the source text itself.
    this.#grammarSource = this.#plain
      ? this.#source
      : this.#grammarSource.append(text.replaceAll("\0", "\uFFFD"));

    for (const line of this.#lineScanner.append(text)) {
      this.writeLine(line);
    }
  }

  public edit(edit: ParserSessionEdit): void {
    if (this.#complete) {
      throw new Error("Cannot edit a completed parser session");
    }

    if (
      !Number.isSafeInteger(edit.start) ||
      !Number.isSafeInteger(edit.end) ||
      edit.start < 0 ||
      edit.end < edit.start ||
      edit.end > this.#source.length
    ) {
      throw InputError.replacementRangeOutsideSource(edit.start, edit.end, this.#source.length);
    }

    const nextSource = this.#source.slice(0, edit.start) + edit.text + this.#source.slice(edit.end);
    const checkpointIndex = findCheckpoint(this.#checkpoints, edit.start);
    const checkpoint = this.#checkpoints[checkpointIndex];
    this.#source = SourceText.of(nextSource);
    this.#plain = !nextSource.includes("\0");

    this.#grammarSource = this.#plain
      ? this.#source
      : SourceText.of(nextSource.replaceAll("\0", "\uFFFD"));
    this.#blockParser = this.#blockParser.fork(checkpoint.parser);
    this.#lineScanner = new PhysicalLineScanner({
      line: checkpoint.line,
      offset: checkpoint.offset,
    });
    this.#checkpoints.length = checkpointIndex + 1;

    for (const line of this.#lineScanner.append(nextSource.slice(checkpoint.offset))) {
      this.writeLine(line);
    }
  }

  public completeDraft(): ParserDraftSnapshot {
    if (this.#complete) {
      throw new Error("Parser session is already complete");
    }

    this.#complete = true;

    for (const line of this.#lineScanner.complete()) {
      this.writeLine(line);
    }

    return {
      file: new SourceFile({ name: this.#name, text: this.#source.toString() }),
      blocks: this.#blockParser.finish(this.#grammarSource),
    };
  }

  /** Finishes a copy of the unsettled tail; the session itself stays open. */
  public tailDraft(): ParserTailDraft {
    if (this.#complete) {
      throw new Error("Parser session is already complete");
    }

    const scanner = this.#lineScanner.clone();
    const parser = this.#blockParser.tail();

    for (const line of scanner.complete()) {
      // An empty last line is where input stopped, not a blank line that closes the open leaf.
      if (line.range.start < line.range.end) {
        parser.write(this.#grammarSource, line);
      }
    }

    const pending = parser.pending();

    return { blocks: parser.finish(this.#grammarSource), pending };
  }

  private writeLine(line: PhysicalLine): void {
    this.#blockParser.write(this.#grammarSource, line);
    const parser = this.#blockParser.checkpoint();

    if (parser !== undefined) {
      this.#checkpoints.push({ line: line.line + 1, offset: line.range.end, parser });
    }
  }
}

function findCheckpoint(checkpoints: readonly SessionCheckpoint[], editStart: number): number {
  let low = 0;
  let high = checkpoints.length;

  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);

    if (checkpoints[middle].offset <= editStart) {
      low = middle;
    } else {
      high = middle;
    }
  }

  return low;
}
