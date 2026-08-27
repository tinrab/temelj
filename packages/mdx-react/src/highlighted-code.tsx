import { HtmlElementNode, HtmlTextNode, type SyntaxHighlighter } from "@temelj/mdx";
import React, { useEffect, useRef, useState } from "react";

import type { MdxRegistry } from "./registry.ts";

import { HtmlNodeContent } from "./source-content.tsx";

export interface HighlightedCodeProps {
  readonly code: string;
  readonly components?: MdxRegistry;
  readonly fallback?: React.ReactNode;
  readonly highlighter?: SyntaxHighlighter;
  readonly language: string;
  readonly meta?: string;
  readonly onError?: (error: unknown) => void;
}

/** Highlights code asynchronously and keeps the plain code block visible while pending. */
export function HighlightedCode({
  code,
  components,
  fallback,
  highlighter,
  language,
  meta,
  onError,
}: HighlightedCodeProps): React.ReactNode {
  const element = React.useMemo(
    () => codeFallbackElement(code, language, meta),
    [code, language, meta],
  );
  const render = React.useMemo(
    () =>
      highlighter === undefined
        ? undefined
        : (signal: AbortSignal) =>
            highlighter.highlight({
              code,
              element,
              language,
              meta,
              signal,
            }),
    [code, element, highlighter, language, meta],
  );

  const rendered = useRenderedElement(render, onError);
  if (rendered === undefined) {
    return fallback ?? <HtmlNodeContent node={element} components={components} />;
  }

  return <HtmlNodeContent node={rendered} components={components} />;
}

function useRenderedElement(
  render: ((signal: AbortSignal) => HtmlElementNode | Promise<HtmlElementNode>) | undefined,
  onError: ((error: unknown) => void) | undefined,
): HtmlElementNode | undefined {
  const [result, setResult] = useState<
    Readonly<{
      element: HtmlElementNode;
      render: (signal: AbortSignal) => HtmlElementNode | Promise<HtmlElementNode>;
    }>
  >();
  const onErrorReference = useRef(onError);
  useEffect(() => {
    onErrorReference.current = onError;
  }, [onError]);
  useEffect(() => {
    const controller = new AbortController();
    if (render === undefined) {
      return () => controller.abort();
    }
    Promise.resolve()
      .then(() => render(controller.signal))
      .then((value) => {
        if (!controller.signal.aborted) {
          setResult({ element: value, render });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          onErrorReference.current?.(error);
        }
      });
    return () => controller.abort();
  }, [render]);
  if (result === undefined || result.render !== render) {
    return undefined;
  }
  return result.element;
}

function codeFallbackElement(
  code: string,
  language: string,
  meta: string | undefined,
): HtmlElementNode {
  return new HtmlElementNode("pre", meta === undefined ? {} : { "data-meta": meta }, [
    new HtmlElementNode("code", { class: [`language-${language}`] }, [
      new HtmlTextNode(code.length === 0 ? "" : `${code}\n`),
    ]),
  ]);
}
