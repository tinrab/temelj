import type { Diagnostic, DiagnosticSeverity } from "./diagnostics.ts";
import type { HtmlFootnoteSectionNode, HtmlRootNode } from "./html.ts";
import type { ParserLimit } from "./parser/config.ts";
import type {
  CompletedBlock,
  MdxPreview,
  MdxStreamChange,
  MdxStreamCompletion,
  MdxStreamOptions,
  PreviewBlock,
} from "./stream-types.ts";

import { LimitError, ParseError } from "./errors.ts";
import { joinBlocks, lowerHtml } from "./html-lower.ts";
import { MdxStream } from "./stream.ts";

/** The preview as one HTML tree, joined like a lowered document. */
export function previewDocument(preview: MdxPreview): HtmlRootNode {
  const children = preview.blocks.flatMap((block) => block.nodes);

  if (preview.footnotes !== undefined) {
    children.push(preview.footnotes);
  }

  return { kind: "root", children: joinBlocks(children) };
}

/** A diagnostic without its source file, so it can cross a network boundary. */
export interface MdxEventDiagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly start?: number;
  readonly end?: number;
}

/**
 * A JSON-serializable stream update. A server runs the stream and sends events;
 * a client applies them with `applyBlockEvent` and renders without parsing.
 */
export type MdxBlockEvent =
  | Readonly<{
      kind: "update";
      /** Blocks before this index stay, except `refreshed`; `blocks` replaces the rest. */
      start: number;
      blocks: readonly PreviewBlock[];
      refreshed: readonly PreviewBlock[];
      /** Present when the section changed; `null` removes it. */
      footnotes?: HtmlFootnoteSectionNode | null;
      limit?: ParserLimit;
    }>
  | Readonly<{ kind: "complete"; html: HtmlRootNode; blocks: readonly CompletedBlock[] }>
  | Readonly<{ kind: "failed"; diagnostics: readonly MdxEventDiagnostic[] }>;

/** The update event for one stream change. */
export function blockEvent(change: MdxStreamChange): Extract<MdxBlockEvent, { kind: "update" }> {
  const { snapshot } = change;

  let event: Extract<MdxBlockEvent, { kind: "update" }> = {
    kind: "update",
    start: change.start,
    blocks: snapshot.blocks.slice(change.start).map(previewBlock),
    refreshed: change.refreshed.map(previewBlock),
  };

  if (change.footnotesChanged) {
    event = { ...event, footnotes: snapshot.footnotes ?? null };
  }

  if (snapshot.limit !== undefined) {
    event = { ...event, limit: snapshot.limit };
  }

  return event;
}

/** The final event for a completion; `html` is the completed document's lowered HTML. */
export function completionEvent(
  completion: MdxStreamCompletion,
  html?: HtmlRootNode,
): MdxBlockEvent {
  return {
    kind: "complete",
    html: html ?? lowerHtml(completion.document, { source: completion.file }),
    blocks: completion.blocks,
  };
}

/** Applies an update event to the preview a client holds. */
export function applyBlockEvent(
  preview: MdxPreview,
  event: Extract<MdxBlockEvent, { kind: "update" }>,
): MdxPreview {
  let kept = preview.blocks.slice(0, event.start);

  if (event.refreshed.length > 0) {
    const refreshed = new Map(event.refreshed.map((block) => [block.id, block]));
    kept = kept.map((block) => refreshed.get(block.id) ?? block);
  }

  return Object.freeze({
    blocks: Object.freeze([...kept, ...event.blocks]),
    footnotes: event.footnotes === undefined ? preview.footnotes : (event.footnotes ?? undefined),
  });
}

export interface StreamBlockEventsOptions extends MdxStreamOptions {
  /** Lowers the completed document, for example through a `Processor` with HTML plugins. */
  readonly html?: (completion: MdxStreamCompletion) => HtmlRootNode;
}

/**
 * Streams text through an `MdxStream`.
 * A server forwards the events to a client as JSON.
 *
 * @yields One update event per chunk, then a completion event.
 */
export async function* streamBlockEvents(
  chunks: AsyncIterable<string>,
  options: StreamBlockEventsOptions = {},
): AsyncGenerator<MdxBlockEvent> {
  const stream = new MdxStream(options);
  const changes: MdxStreamChange[] = [];
  const unsubscribe = stream.subscribe((change) => changes.push(change));

  try {
    const initial = stream.snapshot();

    if (initial.kind === "preview" && initial.file.length > 0) {
      yield blockEvent({
        snapshot: initial,
        start: 0,
        refreshed: [],
        footnotesChanged: true,
      });
    }

    for await (const chunk of chunks) {
      stream.append(chunk);

      for (const change of changes.splice(0)) {
        yield blockEvent(change);
      }
    }
  } finally {
    unsubscribe();
  }

  let completion: MdxStreamCompletion;

  try {
    completion = stream.complete();
  } catch (error) {
    if (!(error instanceof ParseError) && !(error instanceof LimitError)) {
      throw error;
    }

    yield { kind: "failed", diagnostics: error.diagnostics.map(eventDiagnostic) };

    return;
  }

  yield completionEvent(completion, options.html?.(completion));
}

function eventDiagnostic(diagnostic: Diagnostic): MdxEventDiagnostic {
  const message = {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
  };

  return diagnostic.span === undefined
    ? message
    : { ...message, start: diagnostic.span.start, end: diagnostic.span.end };
}

function previewBlock(block: PreviewBlock): PreviewBlock {
  return {
    id: block.id,
    origin: block.origin,
    nodes: block.nodes,
    status: block.status,
    settled: block.settled,
  };
}
