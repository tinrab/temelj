import type { Diagnostic } from "./diagnostics.ts";
import type { HtmlFootnoteSectionNode, HtmlNode } from "./html.ts";
import type { ParseResult } from "./parser.ts";
import type { ParserLimit, ParserLimits } from "./parser/config.ts";
import type { SourceRange } from "./ranges.ts";
import type { SourceFile } from "./source.ts";
import type { SyntaxOptions } from "./syntax-options.ts";

declare const blockIdBrand: unique symbol;

/** Identifies one top-level block for the lifetime of a stream, across appends and edits. */
export type BlockId = string & { readonly [blockIdBrand]: "BlockId" };

export interface MdxEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Identifiers of the link definitions and footnotes a block references. */
export interface StreamDependencies {
  readonly definitions: readonly string[];
  readonly footnotes: readonly string[];
}

/** What a renderer needs from one block. It is plain data, so a server can send it. */
export interface PreviewBlock {
  readonly id: BlockId;
  readonly origin: SourceRange;
  /** Provisional HTML. Open syntax and missing references have their own node kinds. */
  readonly nodes: readonly HtmlNode[];
  /** An `invalid` block renders its authored source as inert text. */
  readonly status: "invalid" | "valid";
  /**
   * Later input cannot change a settled block's syntax. Its rendering can still
   * change when a definition it references changes.
   */
  readonly settled: boolean;
}

/** What a renderer needs from a stream preview. */
export interface MdxPreview {
  readonly blocks: readonly PreviewBlock[];
  /** The footnote section, while any defined footnote is referenced. */
  readonly footnotes: HtmlFootnoteSectionNode | undefined;
}

export interface StreamBlock extends PreviewBlock {
  readonly diagnostics: readonly Diagnostic[];
  readonly dependencies: StreamDependencies;
}

/** A provisional view of incomplete input. Errors stay local to the blocks that contain them. */
export interface MdxStreamSnapshot extends MdxPreview {
  readonly kind: "preview";
  readonly file: SourceFile;
  readonly blocks: readonly StreamBlock[];
  readonly diagnostics: readonly Diagnostic[];
  /** The limit the source exceeds. Blocks then keep the last preview within limits. */
  readonly limit: ParserLimit | undefined;
}

export interface CompletedBlock {
  readonly id: BlockId;
  readonly origin: SourceRange;
}

export interface MdxStreamCompletion extends ParseResult {
  readonly kind: "complete";
  /** The stream blocks that make up the document, with the identities they streamed with. */
  readonly blocks: readonly CompletedBlock[];
}

export interface MdxStreamLimits extends ParserLimits {
  /** The longest top-level block that can contain open syntax. */
  readonly maximumPendingBlockLength?: number;
}

export interface MdxStreamOptions {
  /** Initial source. */
  readonly source?: string;
  /** The file name for diagnostics. */
  readonly name?: string;
  readonly syntax?: SyntaxOptions;
  readonly limits?: MdxStreamLimits;
}

/** What changed between two consecutive snapshots. */
export interface MdxStreamChange {
  readonly snapshot: MdxStreamSnapshot;
  /** Blocks before this index are the previous snapshot's block objects, except `refreshed`. */
  readonly start: number;
  /** Earlier blocks that rendered again because a definition they reference changed. */
  readonly refreshed: readonly StreamBlock[];
  readonly footnotesChanged: boolean;
}
