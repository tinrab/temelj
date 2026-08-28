"use client";

import type {
  CompletedBlockSnapshot,
  Diagnostic,
  MdxStreamSnapshot,
  ProcessOutcome,
} from "@temelj/mdx";
import type { SyntaxOptions } from "@temelj/mdx";

import { MdxStream, Processor, hasErrorDiagnostics } from "@temelj/mdx";
import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { SourceContentProps } from "./source-content.tsx";

import { fallback, renderCompletedDocument, renderStreamingSnapshot } from "./source-content.tsx";

export interface StreamingSourceContentProps extends SourceContentProps {
  readonly onDiagnostics?: (diagnostics: readonly Diagnostic[]) => void;
  readonly status: "streaming" | "complete";
}

type StreamingView =
  | Readonly<{ kind: "streaming"; snapshot: MdxStreamSnapshot }>
  | Readonly<{
      kind: "complete";
      outcome: ProcessOutcome;
      blocks: readonly CompletedBlockSnapshot[];
    }>;

class StreamingSourceStore {
  private readonly listeners = new Set<() => void>();
  private processor: Processor;
  private stream: MdxStream;
  private view: StreamingView;
  private source: string;
  private status: StreamingSourceContentProps["status"];
  private syntax: SyntaxOptions | undefined;

  public constructor(
    source: string,
    status: StreamingSourceContentProps["status"],
    syntax: SyntaxOptions | undefined,
  ) {
    this.processor = syntax === undefined ? new Processor() : new Processor({ syntax });
    this.stream = new MdxStream({ source, syntax: this.processor.syntax });
    this.source = source;
    this.status = status;
    this.syntax = syntax;
    this.view = this.read(status);
  }

  public readonly getSnapshot = (): StreamingView => this.view;

  public readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public update(
    source: string,
    status: StreamingSourceContentProps["status"],
    syntax: SyntaxOptions | undefined,
  ): void {
    if (source === this.source && status === this.status && syntax === this.syntax) {
      return;
    }
    const syntaxChanged = syntax !== this.syntax;
    const wasComplete = this.view.kind === "complete" && this.view.outcome.kind === "processed";
    if (syntaxChanged) {
      this.processor = syntax === undefined ? new Processor() : new Processor({ syntax });
      this.stream = new MdxStream({ source, syntax: this.processor.syntax });
    } else if (wasComplete) {
      this.stream = new MdxStream({ source, syntax: this.processor.syntax });
    } else if (source.startsWith(this.source)) {
      this.stream.append(source.slice(this.source.length));
    } else if (source !== this.source) {
      this.stream.edit(sourceEdit(this.source, source));
    }
    this.source = source;
    this.status = status;
    this.syntax = syntax;
    this.view = this.read(status);
    for (const listener of this.listeners) {
      listener();
    }
  }

  private read(status: StreamingSourceContentProps["status"]): StreamingView {
    if (status === "streaming") {
      const snapshot = this.stream.snapshot();
      if ("kind" in snapshot) {
        this.stream = new MdxStream({ source: snapshot.file, syntax: this.processor.syntax });
        const restarted = this.stream.snapshot();
        if ("kind" in restarted) {
          throw new Error("A new MdxStream cannot be complete");
        }
        return { kind: "streaming", snapshot: restarted };
      }
      return { kind: "streaming", snapshot };
    }
    const completion = this.stream.complete();
    if (completion.kind !== "parsed") {
      return { kind: "complete", outcome: completion, blocks: [] };
    }
    return {
      kind: "complete",
      outcome: this.processor.processSync(completion),
      blocks: completion.blocks,
    };
  }
}

export function StreamingSourceContent({
  source,
  status,
  registry,
  diagnosticFallback,
  math,
  onDiagnostics,
  syntax,
}: StreamingSourceContentProps): React.ReactNode {
  const [store] = useState(() => new StreamingSourceStore(source, status, syntax));
  useEffect(() => store.update(source, status, syntax), [source, status, store, syntax]);
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const diagnostics =
    view.kind === "streaming" ? view.snapshot.diagnostics : view.outcome.diagnostics;
  useDiagnostics(onDiagnostics, diagnostics);
  if (hasErrorDiagnostics(diagnostics)) {
    return fallback(diagnosticFallback, diagnostics);
  }
  if (view.kind === "streaming") {
    return renderStreamingSnapshot(view.snapshot, registry, math);
  }
  if (view.outcome.kind !== "processed") {
    return fallback(diagnosticFallback, view.outcome.diagnostics);
  }
  return renderCompletedDocument(view.outcome, view.blocks, registry, math);
}

function sourceEdit(
  previous: string,
  next: string,
): Readonly<{ start: number; end: number; text: string }> {
  let start = 0;
  const sharedLength = Math.min(previous.length, next.length);
  while (start < sharedLength && previous[start] === next[start]) {
    start++;
  }
  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previous[previousEnd - 1] === next[nextEnd - 1]
  ) {
    previousEnd--;
    nextEnd--;
  }
  return { start, end: previousEnd, text: next.slice(start, nextEnd) };
}

function useDiagnostics(
  onDiagnostics: ((diagnostics: readonly Diagnostic[]) => void) | undefined,
  diagnostics: readonly Diagnostic[],
): void {
  const delivered = useRef<Readonly<{
    callback: (diagnostics: readonly Diagnostic[]) => void;
    diagnostics: readonly Diagnostic[];
  }> | null>(null);
  useEffect(() => {
    if (
      onDiagnostics === undefined ||
      (delivered.current?.callback === onDiagnostics &&
        delivered.current.diagnostics === diagnostics)
    ) {
      return;
    }
    delivered.current = { callback: onDiagnostics, diagnostics };
    onDiagnostics(diagnostics);
  }, [diagnostics, onDiagnostics]);
}
