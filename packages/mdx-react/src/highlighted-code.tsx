"use client";

import { HtmlElementNode, HtmlTextNode, type HtmlAttributeValue } from "@temelj/mdx";
import {
  SyntaxHighlightMetadataError,
  parseCodeBlockMetadata,
  type SyntaxHighlightRequest,
  type SyntaxHighlighter,
} from "@temelj/mdx/plugin";
import React, { useEffect, useRef, useState } from "react";

import type { MdxRegistry } from "./registry.ts";

import { HtmlNodeContent } from "./source-content.tsx";

type CodeRender = (signal: AbortSignal) => Promise<HtmlElementNode | undefined>;

type CodeRenderResult =
  | Readonly<{
      element: HtmlElementNode;
      kind: "highlighted";
    }>
  | Readonly<{
      kind: "unavailable";
    }>;

type SynchronousCodeResult =
  | Readonly<{ element: HtmlElementNode | undefined; kind: "settled" }>
  | Readonly<{ error: unknown; kind: "failed" }>;

export interface HighlightedCodeProps {
  readonly code: string;
  readonly registry?: MdxRegistry;
  readonly fallback?: React.ReactNode;
  readonly highlighter?: SyntaxHighlighter;
  readonly language?: string;
  readonly meta?: string;
  readonly onError?: (error: unknown) => void;
}

/** Highlights code and keeps the previous rendered block mounted during asynchronous updates. */
export function HighlightedCode({
  code,
  registry,
  fallback,
  highlighter,
  language,
  meta,
  onError,
}: HighlightedCodeProps): React.ReactNode {
  const normalizedLanguage = normalizeLanguage(language);
  const metadata = React.useMemo(() => parseCodeBlockMetadata(meta), [meta]);
  const onErrorReference = useRef(onError);
  useEffect(() => {
    onErrorReference.current = onError;
  }, [onError]);
  useEffect(() => {
    if (metadata.kind === "invalid") {
      onErrorReference.current?.(new SyntaxHighlightMetadataError(metadata.issues));
    }
  }, [metadata, onErrorReference]);
  const request = React.useMemo<SyntaxHighlightRequest | undefined>(
    () =>
      normalizedLanguage === undefined
        ? undefined
        : { code, language: normalizedLanguage, metadata: metadata.metadata },
    [code, metadata, normalizedLanguage],
  );
  const synchronousResult = React.useMemo(
    () => synchronousHighlight(highlighter, request),
    [highlighter, request],
  );
  useEffect(() => {
    if (synchronousResult?.kind === "failed") {
      onErrorReference.current?.(synchronousResult.error);
    }
  }, [onErrorReference, synchronousResult]);
  const element = React.useMemo(
    () => codeFallbackElement(code, normalizedLanguage),
    [code, normalizedLanguage],
  );
  const render = React.useMemo(
    () =>
      highlighter?.kind !== "asynchronous" || request === undefined
        ? undefined
        : (signal: AbortSignal) => highlighter.highlight({ ...request, signal }),
    [highlighter, request],
  );

  const asynchronousElement = useRenderedElement(render, onErrorReference);
  const rendered =
    synchronousResult?.kind === "settled" ? synchronousResult.element : asynchronousElement;
  if (rendered === undefined) {
    return fallback ?? <HtmlNodeContent node={element} registry={registry} />;
  }

  return <HtmlNodeContent node={rendered} registry={registry} />;
}

function synchronousHighlight(
  highlighter: SyntaxHighlighter | undefined,
  request: SyntaxHighlightRequest | undefined,
): SynchronousCodeResult | undefined {
  if (highlighter?.kind !== "synchronous" || request === undefined) {
    return;
  }
  try {
    return { element: highlighter.highlight(request), kind: "settled" };
  } catch (error) {
    return { error, kind: "failed" };
  }
}

function useRenderedElement(
  render: CodeRender | undefined,
  onErrorReference: React.RefObject<((error: unknown) => void) | undefined>,
): HtmlElementNode | undefined {
  const [result, setResult] = useState<CodeRenderResult>();
  useEffect(() => {
    const controller = new AbortController();
    if (render === undefined) {
      return () => controller.abort();
    }
    Promise.resolve()
      .then(() => render(controller.signal))
      .then((value) => {
        if (!controller.signal.aborted) {
          setResult(
            value === undefined ? { kind: "unavailable" } : { element: value, kind: "highlighted" },
          );
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setResult({ kind: "unavailable" });
          onErrorReference.current?.(error);
        }
      });
    return () => controller.abort();
  }, [onErrorReference, render]);
  if (render === undefined || result?.kind !== "highlighted") {
    return undefined;
  }
  return result.element;
}

function normalizeLanguage(language: string | undefined): string | undefined {
  const normalized = language?.trim().split(/\s+/u)[0];
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function codeFallbackElement(code: string, language: string | undefined): HtmlElementNode {
  const attributes: Readonly<Record<string, HtmlAttributeValue>> =
    language === undefined ? {} : { class: [`language-${language}`] };
  return new HtmlElementNode("pre", {}, [
    new HtmlElementNode("code", attributes, [
      new HtmlTextNode(code.length === 0 ? "" : `${code}\n`),
    ]),
  ]);
}
