"use client";

import type { CompletedBlock, HtmlNode, MdxPreview } from "@temelj/mdx";

import React, { createContext, useContext, useMemo } from "react";

import type { DiagnosticFallback } from "./fallback.ts";
import type { RenderCache } from "./html-renderer.tsx";
import type { MdxRegistry } from "./registry.ts";
import type { MdxStreamView } from "./stream-store.ts";

import { renderFallback } from "./fallback.ts";
import { renderHtmlNodes } from "./html-renderer.tsx";

/** `pending` for the open tail of a stream, which may still change. */
export type MdxBlockStatus = "complete" | "pending";

const BlockStatusContext = createContext<MdxBlockStatus>("complete");

/** Lets components inside a stream block defer expensive work until the block settles. */
export function useMdxBlockStatus(): MdxBlockStatus {
  return useContext(BlockStatusContext);
}

export interface StreamContentProps {
  readonly view: MdxStreamView;
  readonly registry?: MdxRegistry;
  /** Replaces the preview after a failed strict completion. */
  readonly fallback?: DiagnosticFallback;
}

/**
 * Renders a stream view without parsing source or running plugins. Blocks keep
 * their identity by `BlockId`, so settled blocks do not re-render, and nodes
 * that keep their identity inside the open block reuse their elements.
 */
export function StreamContent({ view, registry, fallback }: StreamContentProps): React.ReactNode {
  const cache = renderCache(registry);

  const completed = useMemo(
    () => (view.kind === "complete" ? completedGroups(view.html.children, view.blocks) : undefined),
    [view],
  );

  let content: React.ReactNode;

  if (view.kind === "failed" && fallback !== undefined) {
    content = renderFallback(fallback, view.diagnostics);
  } else if (completed !== undefined) {
    content = completed.map((group) => (
      <Block
        cache={cache}
        key={group.key}
        nodes={group.nodes}
        registry={registry}
        status="complete"
      />
    ));
  } else if (view.kind !== "complete") {
    content = renderPreview(view.preview, registry, cache);
  }

  return <React.Fragment key={view.generation}>{content}</React.Fragment>;
}

function renderPreview(
  preview: MdxPreview,
  registry: MdxRegistry | undefined,
  cache: RenderCache,
): React.ReactNode[] {
  const rendered: React.ReactNode[] = [];

  for (const block of preview.blocks) {
    if (block.nodes.length === 0) {
      continue;
    }

    if (rendered.length > 0) {
      rendered.push(<React.Fragment key={`separator-${block.id}`}>{"\n"}</React.Fragment>);
    }

    rendered.push(
      <Block
        cache={cache}
        key={block.id}
        nodes={block.nodes}
        registry={registry}
        status={block.settled ? "complete" : "pending"}
      />,
    );
  }

  if (preview.footnotes !== undefined) {
    rendered.push(
      <Block
        cache={cache}
        key="document-footnotes"
        nodes={[preview.footnotes]}
        registry={registry}
        status="pending"
      />,
    );
  }

  return rendered;
}

const noRegistry = {};

/** Elements by node, per registry. Nodes are immutable, so every stream can share one cache. */
const renderCaches = new WeakMap<object, RenderCache>();

function renderCache(registry: MdxRegistry | undefined): RenderCache {
  const owner = registry ?? noRegistry;
  let cache = renderCaches.get(owner);

  if (cache === undefined) {
    cache = new WeakMap();
    renderCaches.set(owner, cache);
  }

  return cache;
}

type BlockProps = Readonly<{
  cache: RenderCache;
  nodes: readonly HtmlNode[];
  registry: MdxRegistry | undefined;
  status: MdxBlockStatus;
}>;

const Block = React.memo(
  function Block({ cache, nodes, registry, status }: BlockProps): React.ReactNode {
    return (
      <BlockStatusContext.Provider value={status}>
        {renderHtmlNodes(nodes, registry, cache)}
      </BlockStatusContext.Provider>
    );
  },
  (previous, next) =>
    previous.cache === next.cache &&
    previous.registry === next.registry &&
    previous.status === next.status &&
    sameNodes(previous.nodes, next.nodes),
);

/** The footnote section is wrapped in a fresh array, so blocks compare their nodes. */
function sameNodes(left: readonly HtmlNode[], right: readonly HtmlNode[]): boolean {
  return (
    left === right ||
    (left.length === right.length && left.every((node, index) => node === right[index]))
  );
}

interface HtmlGroup {
  readonly key: string;
  readonly nodes: readonly HtmlNode[];
}

/** Groups completed top-level nodes by the stream block that produced them. */
function completedGroups(
  nodes: readonly HtmlNode[],
  blocks: readonly CompletedBlock[],
): readonly HtmlGroup[] {
  const groups: Array<{ readonly base: string; key: string; nodes: HtmlNode[] }> = [];
  const occurrences = new Map<string, number>();
  let cursor = 0;

  for (const [index, node] of nodes.entries()) {
    const origin = node.origin;

    // Nodes and blocks share document order, so one forward scan finds each block.
    while (
      origin !== undefined &&
      cursor < blocks.length &&
      blocks[cursor].origin.end < origin.start
    ) {
      cursor++;
    }

    const block =
      origin === undefined ||
      blocks[cursor] === undefined ||
      blocks[cursor].origin.start > origin.start ||
      origin.end > blocks[cursor].origin.end
        ? undefined
        : blocks[cursor];

    const base =
      node.kind === "footnoteSection" ? "document-footnotes" : (block?.id ?? `node-${index}`);

    const previous = groups.at(-1);

    if (previous?.base === base) {
      previous.nodes.push(node);
      continue;
    }

    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    groups.push({ base, key: occurrence === 0 ? base : `${base}-${occurrence}`, nodes: [node] });
  }

  return groups;
}
