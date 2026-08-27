import type { PhysicalLine } from "../source.ts";
import type { BlockParserCheckpoint } from "./block-parser.ts";
import type { BlockSyntax } from "./block-syntax.ts";
import type { PendingBlockSyntax } from "./block-syntax.ts";
import type { ParserLimits, ResolvedParserLimits } from "./config.ts";

import { InputError } from "../errors.ts";
import { SourceFile, PhysicalLineScanner } from "../source.ts";
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
}

export interface ParserDraftSnapshot {
  readonly file: SourceFile;
  readonly blocks: readonly BlockSyntax[];
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
  #grammarSource = "";
  #name = "source.mdx";
  #source = "";

  public constructor(options: ParserSessionOptions = {}) {
    this.limits = resolveParserLimits(options.limits);
    this.syntax = resolveSyntaxOptions(options.syntax);
    this.#blockParser = new BlockParser(this.syntax);
    this.#lineScanner = new PhysicalLineScanner();
    this.#checkpoints = [{ line: 1, offset: 0, parser: { blocks: [] } }];
    if (options.source instanceof SourceFile) {
      this.#name = options.source.name;
    }
    const source =
      options.source instanceof SourceFile ? options.source.text : (options.source ?? "");
    if (source !== "") {
      this.append(source);
    }
  }

  public append(text: string): void {
    if (this.#complete) {
      throw new Error("Cannot append to a completed parser session");
    }
    this.#source += text;
    this.#grammarSource += text.replaceAll("\0", "\uFFFD");
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
      InputError.replacementRangeOutsideSource(edit.start, edit.end, this.#source.length);
    }

    const nextSource = this.#source.slice(0, edit.start) + edit.text + this.#source.slice(edit.end);
    const checkpointIndex = findCheckpoint(this.#checkpoints, edit.start);
    const checkpoint = this.#checkpoints[checkpointIndex];
    this.#source = nextSource;
    this.#grammarSource = nextSource.replaceAll("\0", "\uFFFD");
    this.#blockParser = new BlockParser(this.syntax, checkpoint.parser);
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
      file: new SourceFile({ name: this.#name, text: this.#source }),
      blocks: this.#blockParser.finish(this.#grammarSource),
    };
  }

  public finalDraft(): ParserDraftSnapshot {
    if (this.#complete) {
      throw new Error("Parser session is already complete");
    }
    const scanner = this.#lineScanner.clone();
    const parser = this.#blockParser.clone();
    for (const line of scanner.complete()) {
      parser.write(this.#grammarSource, line);
    }
    const pending = parser.pending();
    return {
      file: new SourceFile({ name: this.#name, text: this.#source }),
      blocks: parser.finish(this.#grammarSource),
      pending,
    };
  }

  public makeTerminal(): void {
    if (this.#complete) {
      throw new Error("Parser session is already complete");
    }
    this.#complete = true;
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
