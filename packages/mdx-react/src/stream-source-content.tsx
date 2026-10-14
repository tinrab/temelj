"use client";

import type { Diagnostic } from "@temelj/mdx";

import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import type { DiagnosticFallback } from "./fallback.ts";
import type { MdxRegistry } from "./registry.ts";

import { StreamContent } from "./stream-content.tsx";
import { MdxStreamStore, type MdxStreamStoreOptions, type MdxStreamView } from "./stream-store.ts";

export interface StreamSourceContentProps extends Omit<MdxStreamStoreOptions, "source"> {
  /** The whole source so far, such as a chat message that grows with each token. */
  readonly source: string;
  readonly status: "streaming" | "complete";
  readonly registry?: MdxRegistry;
  readonly fallback?: DiagnosticFallback;
  readonly onDiagnostics?: (diagnostics: readonly Diagnostic[]) => void;
}

const useBrowserLayoutEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;

/**
 * Renders a growing source string. Appends reuse the parser session, so each
 * update costs only the new text. Options initialize the session.
 */
export function StreamSourceContent({
  source,
  status,
  registry,
  fallback,
  onDiagnostics,
  ...options
}: StreamSourceContentProps): React.ReactNode {
  const [store] = useState(() => {
    const created = new MdxStreamStore({ ...options, source });
    created.setSource(source, status);

    return created;
  });

  // A layout effect applies the update before paint, so the new text never lags a frame.
  useBrowserLayoutEffect(() => store.setSource(source, status), [source, status, store]);
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useDiagnostics(onDiagnostics, view);

  return <StreamContent fallback={fallback} registry={registry} view={view} />;
}

function useDiagnostics(
  onDiagnostics: ((diagnostics: readonly Diagnostic[]) => void) | undefined,
  view: MdxStreamView,
): void {
  const diagnostics =
    view.kind === "streaming"
      ? view.snapshot.diagnostics
      : view.kind === "complete"
        ? view.diagnostics
        : view.completion.diagnostics;

  const delivered = useRef<readonly Diagnostic[] | null>(null);

  useEffect(() => {
    if (onDiagnostics === undefined || delivered.current === diagnostics) {
      return;
    }

    delivered.current = diagnostics;
    onDiagnostics(diagnostics);
  }, [diagnostics, onDiagnostics]);
}
