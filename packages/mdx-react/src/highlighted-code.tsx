"use client";

import type { HtmlElementNode } from "@temelj/mdx";

import { htmlFallback } from "@temelj/mdx";
import {
  parseCodeBlockMetadata,
  CodeBlockMetadataError,
  type SyntaxHighlighter,
  type SyntaxHighlightRequest,
} from "@temelj/mdx/plugins";
import React, { useEffect, useMemo, useRef, useState } from "react";

import type { MdxRegistry } from "./registry.ts";

import { HtmlContent } from "./content.tsx";
import { useMdxBlockStatus } from "./stream-content.tsx";

type CodeRenderResult =
  | Readonly<{ element: HtmlElementNode; kind: "highlighted" }>
  | Readonly<{ kind: "unavailable" }>;

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
  /**
   * While `pending`, only completed lines are highlighted and the open line is
   * appended as text, so a growing fence is highlighted once per line. Defaults
   * to the enclosing stream block's status.
   */
  readonly status?: "complete" | "pending";
  readonly onError?: (cause: unknown) => void;
}

/** Highlights code and keeps the previous rendered block mounted during asynchronous updates. */
export function HighlightedCode({
  code,
  registry,
  fallback,
  highlighter,
  language,
  meta,
  status,
  onError,
}: HighlightedCodeProps): React.ReactNode {
  const blockStatus = useMdxBlockStatus();
  const pending = (status ?? blockStatus) === "pending";
  const lineEnd = pending ? code.lastIndexOf("\n") : code.length;
  const stable = lineEnd < 0 ? "" : code.slice(0, lineEnd);
  const tail = lineEnd < 0 ? code : code.slice(lineEnd);
  const normalizedLanguage = normalizeLanguage(language);

  const parsedMetadata = useMemo(() => {
    try {
      return { metadata: parseCodeBlockMetadata(meta), error: undefined };
    } catch (error) {
      if (!(error instanceof CodeBlockMetadataError)) {
        throw error;
      }

      return { metadata: error.metadata, error };
    }
  }, [meta]);

  const { metadata } = parsedMetadata;
  const onErrorReference = useRef(onError);

  useEffect(() => {
    onErrorReference.current = onError;
  }, [onError]);

  useEffect(() => {
    if (parsedMetadata.error !== undefined) {
      onErrorReference.current?.(parsedMetadata.error);
    }
  }, [parsedMetadata]);

  const request = useMemo<SyntaxHighlightRequest | undefined>(
    () =>
      normalizedLanguage === undefined || stable.length === 0
        ? undefined
        : { code: stable, language: normalizedLanguage, metadata },
    [metadata, normalizedLanguage, stable],
  );

  const synchronous = useMemo(
    () => synchronousHighlight(highlighter, request),
    [highlighter, request],
  );

  useEffect(() => {
    if (synchronous?.kind === "failed") {
      onErrorReference.current?.(synchronous.error);
    }
  }, [synchronous]);

  const asynchronous = useAsynchronousHighlight(highlighter, request, onErrorReference);
  const rendered = synchronous?.kind === "settled" ? synchronous.element : asynchronous;

  if (rendered !== undefined) {
    return (
      <HtmlContent
        registry={registry}
        tree={tail.length === 0 ? rendered : withTail(rendered, tail)}
      />
    );
  }

  return (
    fallback ?? (
      <HtmlContent
        registry={registry}
        tree={
          normalizedLanguage === undefined
            ? plainCode(code)
            : htmlFallback({ kind: "codeBlock", code, language: normalizedLanguage })
        }
      />
    )
  );
}

function synchronousHighlight(
  highlighter: SyntaxHighlighter | undefined,
  request: SyntaxHighlightRequest | undefined,
): SynchronousCodeResult | undefined {
  if (highlighter?.kind !== "synchronous" || request === undefined) {
    return undefined;
  }

  try {
    return { element: highlighter.highlight(request), kind: "settled" };
  } catch (error) {
    return { error, kind: "failed" };
  }
}

/** Keeps the last highlighted element until a newer request settles. */
function useAsynchronousHighlight(
  highlighter: SyntaxHighlighter | undefined,
  request: SyntaxHighlightRequest | undefined,
  onErrorReference: React.RefObject<((cause: unknown) => void) | undefined>,
): HtmlElementNode | undefined {
  const [result, setResult] = useState<CodeRenderResult>();
  const active = highlighter?.kind === "asynchronous" && request !== undefined;

  useEffect(() => {
    if (highlighter?.kind !== "asynchronous" || request === undefined) {
      return;
    }

    const controller = new AbortController();

    Promise.resolve()
      .then(() => highlighter.highlight({ ...request, signal: controller.signal }))
      .then(
        (element) => {
          if (!controller.signal.aborted) {
            setResult(
              element === undefined ? { kind: "unavailable" } : { element, kind: "highlighted" },
            );
          }
        },
        (cause: unknown) => {
          if (!controller.signal.aborted) {
            setResult({ kind: "unavailable" });
            onErrorReference.current?.(cause);
          }
        },
      );

    return () => controller.abort();
  }, [highlighter, onErrorReference, request]);

  return active && result?.kind === "highlighted" ? result.element : undefined;
}

function normalizeLanguage(language: string | undefined): string | undefined {
  const normalized = language?.trim().split(/\s+/u)[0];

  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

/** Appends the open line to the innermost `code` element, or to the root element. */
function withTail(element: HtmlElementNode, tail: string): HtmlElementNode {
  const index = element.children.findLastIndex(
    (child) => child.kind === "element" && child.tagName === "code",
  );

  const code = element.children[index];

  if (code?.kind === "element") {
    const children = [...element.children];
    children[index] = withTail(code, tail);

    return { ...element, children };
  }

  return { ...element, children: [...element.children, { kind: "text", value: tail }] };
}

function plainCode(code: string): HtmlElementNode {
  return {
    kind: "element",
    tagName: "pre",
    attributes: {},
    children: [
      {
        kind: "element",
        tagName: "code",
        attributes: {},
        children: [{ kind: "text", value: code.length === 0 ? "" : `${code}\n` }],
      },
    ],
  };
}
