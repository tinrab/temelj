import type { Diagnostic } from "./diagnostics.ts";
import type { DocumentNode, FlowContent } from "./model.ts";
import type { ParserLimit, ParserLimits } from "./parser/config.ts";
import type { ReferenceCandidate } from "./parser/materialize.ts";
import type { SourceFile } from "./source.ts";
import type { StreamingDocument } from "./streaming-document.ts";
import type { SyntaxOptions } from "./syntax-options.ts";

declare const blockIdBrand: unique symbol;
export type BlockId = string & { readonly [blockIdBrand]: "BlockId" };

export interface MdxEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface StreamDependencies {
  readonly definitions: readonly string[];
  readonly footnotes: readonly string[];
}

export interface StreamingBlockSnapshot {
  readonly id: BlockId;
  readonly range: Readonly<{ start: number; end: number }>;
  readonly document: StreamingDocument;
  readonly dependencies: StreamDependencies;
}

export interface CompletedBlockSnapshot {
  readonly id: BlockId;
  readonly range: Readonly<{ start: number; end: number }>;
  readonly document: DocumentNode;
  readonly dependencies: StreamDependencies;
}

export interface MdxStreamSnapshot {
  readonly file: SourceFile;
  readonly document: StreamingDocument;
  readonly blocks: readonly StreamingBlockSnapshot[];
  readonly diagnostics: readonly Diagnostic[];
  readonly status: "valid" | "invalid" | "limitExceeded";
}

export type MdxStreamCompletion =
  | Readonly<{
      kind: "parsed";
      file: SourceFile;
      document: DocumentNode;
      blocks: readonly CompletedBlockSnapshot[];
      diagnostics: readonly Diagnostic[];
    }>
  | Readonly<{
      kind: "invalid";
      file: SourceFile;
      diagnostics: readonly [Diagnostic, ...Diagnostic[]];
    }>
  | Readonly<{
      kind: "limitExceeded";
      file: SourceFile;
      limit: ParserLimit;
      diagnostics: readonly [Diagnostic, ...Diagnostic[]];
    }>;

export interface MdxStreamOptions {
  readonly source?: string | SourceFile;
  readonly syntax?: SyntaxOptions;
  readonly limits?: ParserLimits;
  readonly maximumPendingBlockLength?: number;
}

export interface OwnedBlock {
  readonly id: BlockId;
  readonly range: Readonly<{ start: number; end: number }>;
  readonly node: FlowContent;
  readonly dependencies: StreamDependencies;
  readonly candidates: readonly ReferenceCandidate[];
  readonly streaming: StreamingDocument;
}
