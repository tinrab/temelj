import type { HtmlNode, ParseOptions } from "@temelj/mdx";

import { hasErrorDiagnostics, lowerHtml, parse } from "@temelj/mdx";
import React from "react";

import type { DiagnosticFallback } from "./fallback.ts";
import type { MdxRegistry } from "./registry.ts";
import type { CompiledContentModule } from "./types.ts";

import { renderFallback } from "./fallback.ts";
import { renderHtmlNode } from "./html-renderer.tsx";

export interface HtmlContentProps {
  /** Lowered HTML from `lowerHtml`, a processor outcome, or a tree sent from a server. */
  readonly tree: HtmlNode;
  readonly registry?: MdxRegistry;
}

/** Renders lowered HTML. Hook-free, so it also runs in React Server Components. */
export function HtmlContent({ tree, registry }: HtmlContentProps): React.ReactNode {
  return renderHtmlNode(tree, registry, "root", false);
}

export interface SourceContentProps extends ParseOptions {
  readonly source: string;
  readonly registry?: MdxRegistry;
  readonly fallback?: DiagnosticFallback;
}

/**
 * Parses and lowers source during render without plugins or evaluation. Parse
 * outside React, or memoize, when the same source renders repeatedly.
 */
export function SourceContent({
  source,
  registry,
  fallback,
  syntax,
  limits,
}: SourceContentProps): React.ReactNode {
  const parsed = parse(source, { syntax, limits });

  if (parsed.kind !== "ok" || hasErrorDiagnostics(parsed.diagnostics)) {
    return renderFallback(fallback, parsed.diagnostics);
  }

  return (
    <HtmlContent registry={registry} tree={lowerHtml(parsed.document, { source: parsed.file })} />
  );
}

interface CompiledContentOptions<Props extends object> {
  readonly module: CompiledContentModule<Props>;
  readonly registry?: MdxRegistry;
}

export type CompiledContentProps<Props extends object = Record<never, never>> =
  CompiledContentOptions<Props> &
    (Record<never, never> extends Props
      ? { readonly props?: Readonly<Props> }
      : { readonly props: Readonly<Props> });

/** Renders a trusted module that the caller compiled and evaluated explicitly. */
export function CompiledContent<Props extends object = Record<never, never>>(
  options: CompiledContentProps<Props>,
): React.ReactNode;
export function CompiledContent({
  module,
  registry,
  props,
}: Readonly<{
  module: Readonly<{ default: React.ElementType }>;
  registry?: MdxRegistry;
  props?: object;
}>): React.ReactNode {
  return React.createElement(module.default, { ...props, registry });
}
