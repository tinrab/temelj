"use client";

import type { CompletedBlockSnapshot, HtmlNode, MdxStreamSnapshot } from "@temelj/mdx";

import React, { createContext, useContext, useMemo } from "react";

import type { DiagnosticFallback } from "./fallback.ts";
import type { MdxRegistry } from "./registry.ts";
import type { MdxStreamView } from "./stream-store.ts";

import { renderFallback } from "./fallback.ts";
import { renderHtmlNodes } from "./html-renderer.tsx";
import { renderStreamingNodes } from "./streaming-renderer.tsx";

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
 * their identity by `BlockId`, so settled blocks do not re-render.
 */
export function StreamContent({ view, registry, fallback }: StreamContentProps): React.ReactNode {
  const completed = useMemo(
    () =>
      view.kind === "complete"
        ? completedGroups(view.html.children, view.completion.blocks)
        : undefined,
    [view],
  );

  let content: React.ReactNode;

  if (view.kind === "failed" && fallback !== undefined) {
    content = renderFallback(fallback, view.completion.diagnostics);
  } else if (completed !== undefined) {
    content = completed.map((group) => (
      <Block key={group.key} nodes={group.nodes} registry={registry} status="complete" />
    ));
  } else if (view.kind !== "complete") {
    content = renderSnapshot(view.snapshot, registry);
  }

  return <React.Fragment key={view.generation}>{content}</React.Fragment>;
}

function renderSnapshot(
  snapshot: MdxStreamSnapshot,
  registry: MdxRegistry | undefined,
): React.ReactNode[] {
  const rendered: React.ReactNode[] = [];
  const last = snapshot.blocks.at(-1);

  for (const block of snapshot.blocks) {
    if (block.document.children.length === 0) {
      continue;
    }

    if (rendered.length > 0) {
      rendered.push(<React.Fragment key={`separator-${block.id}`}>{"\n"}</React.Fragment>);
    }

    rendered.push(
      <Block
        key={block.id}
        registry={registry}
        status={block === last ? "pending" : "complete"}
        streaming={block.document.children}
      />,
    );
  }

  if (snapshot.supplement.children.length > 0) {
    rendered.push(
      <Block
        key="document-footnotes"
        registry={registry}
        status="pending"
        streaming={snapshot.supplement.children}
      />,
    );
  }

  return rendered;
}

type BlockProps = Readonly<{
  registry: MdxRegistry | undefined;
  status: MdxBlockStatus;
}> &
  (
    | Readonly<{ streaming: MdxStreamSnapshot["document"]["children"]; nodes?: never }>
    | Readonly<{ nodes: readonly HtmlNode[]; streaming?: never }>
  );

const Block = React.memo(function Block({
  registry,
  status,
  streaming,
  nodes,
}: BlockProps): React.ReactNode {
  return (
    <BlockStatusContext.Provider value={status}>
      {streaming === undefined
        ? renderHtmlNodes(nodes, registry)
        : renderStreamingNodes(streaming, registry)}
    </BlockStatusContext.Provider>
  );
});

interface HtmlGroup {
  readonly key: string;
  readonly nodes: readonly HtmlNode[];
}

/** Groups completed top-level nodes by the stream block that produced them. */
function completedGroups(
  nodes: readonly HtmlNode[],
  blocks: readonly CompletedBlockSnapshot[],
): readonly HtmlGroup[] {
  const groups: Array<{ readonly base: string; key: string; nodes: HtmlNode[] }> = [];
  const occurrences = new Map<string, number>();

  for (const [index, node] of nodes.entries()) {
    const origin = node.origin;

    const block =
      origin === undefined
        ? undefined
        : blocks.find((item) => item.range.start <= origin.start && origin.end <= item.range.end);

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
