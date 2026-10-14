import type { StreamingJsx, StreamingNode, StreamingPendingMarkdownNode } from "@temelj/mdx";

import React from "react";

import type { MdxRegistry } from "./registry.ts";

import { createMdxElement, renderHtmlNode } from "./html-renderer.tsx";
import { reservedMdxProps } from "./types.ts";

const reservedProps: ReadonlySet<string> = new Set(reservedMdxProps);

/** Renders provisional streaming nodes. Pending executable syntax never invokes components. */
export function renderStreamingNodes(
  nodes: readonly StreamingNode[],
  registry: MdxRegistry | undefined,
  inSvg = false,
): React.ReactNode[] {
  return nodes.map((node, index) => renderStreamingNode(node, registry, index, inSvg));
}

function renderStreamingNode(
  node: StreamingNode,
  registry: MdxRegistry | undefined,
  key: React.Key,
  inSvg: boolean,
): React.ReactNode {
  switch (node.kind) {
    case "text":
    case "raw":
      return node.value;
    case "omitted":
    case "pendingEsm":
      return null;
    case "pendingExpression":
    case "pendingMath":
      return node.authored;
    case "codeBlock":
    case "math":
      return renderHtmlNode({ ...node, origin: node.range }, registry, key, inSvg);
    case "pendingStrong":
    case "pendingEmphasis":
    case "pendingDelete":
    case "pendingCode":
    case "pendingLink":
    case "pendingImage":
    case "pendingFencedCode":
    case "unresolvedLinkReference":
    case "unresolvedImageReference":
    case "unresolvedFootnoteReference":
    case "footnoteReference":
    case "footnoteSection":
      return renderPendingMarkdown(node, registry, key, inSvg);
    case "jsx":
      return renderStreamingJsx(node, registry, key);
    case "element": {
      const svg = inSvg || node.tagName === "svg";

      const children = renderStreamingNodes(
        node.children,
        registry,
        svg && node.tagName !== "foreignObject",
      );

      return createMdxElement({ ...node, origin: node.range }, registry, key, svg, children);
    }

    default: {
      const exhaustive: never = node;

      return exhaustive;
    }
  }
}

function renderPendingMarkdown(
  node: StreamingPendingMarkdownNode,
  registry: MdxRegistry | undefined,
  key: React.Key,
  inSvg: boolean,
): React.ReactNode {
  const CodeBlock = registry?.markdown.codeBlock;

  if (node.kind === "pendingFencedCode" && CodeBlock !== undefined) {
    return (
      <CodeBlock
        code={node.value}
        key={key}
        language={node.language}
        meta={node.meta}
        node={node}
        status="pending"
      />
    );
  }

  const rendered = renderDefaultPendingMarkdown(node, registry, key, inSvg);
  const Pending = registry?.pending.markdown;

  return Pending === undefined ? (
    rendered
  ) : (
    <Pending key={key} node={node}>
      {rendered}
    </Pending>
  );
}

function renderDefaultPendingMarkdown(
  node: StreamingPendingMarkdownNode,
  registry: MdxRegistry | undefined,
  key: React.Key,
  inSvg: boolean,
): React.ReactNode {
  switch (node.kind) {
    case "footnoteReference":
    case "footnoteSection":
      return renderStreamingNode(node.content, registry, key, inSvg);
    case "pendingStrong":
      return <strong key={key}>{renderStreamingNodes(node.children, registry, inSvg)}</strong>;
    case "pendingEmphasis":
      return <em key={key}>{renderStreamingNodes(node.children, registry, inSvg)}</em>;
    case "pendingDelete":
      return <del key={key}>{renderStreamingNodes(node.children, registry, inSvg)}</del>;
    case "pendingLink":
    case "unresolvedLinkReference":
      return node.kind === "pendingLink" ? (
        <span key={key}>{renderStreamingNodes(node.children, registry, inSvg)}</span>
      ) : (
        node.authored
      );
    case "pendingCode":
      return <code key={key}>{node.value}</code>;
    case "pendingImage":
      return node.alt;
    case "pendingFencedCode":
      return (
        <pre key={key}>
          <code className={node.language === undefined ? undefined : `language-${node.language}`}>
            {lineGroups(node.value)}
          </code>
        </pre>
      );
    case "unresolvedImageReference":
    case "unresolvedFootnoteReference":
      return node.authored;
    default: {
      const exhaustive: never = node;

      return exhaustive;
    }
  }
}

function renderStreamingJsx(
  node: StreamingJsx,
  registry: MdxRegistry | undefined,
  key: React.Key,
): React.ReactNode {
  const inert = node.state === "complete" ? node.authored : null;
  const entry = node.name === undefined ? undefined : registry?.jsx[node.name];

  if (
    !node.safe ||
    node.name === undefined ||
    entry === undefined ||
    Object.keys(node.attributes).some((name) => reservedProps.has(name))
  ) {
    return inert;
  }

  const children = renderStreamingNodes(node.children, registry);

  if (node.state === "complete") {
    return React.createElement(entry.component, { ...node.attributes, key, node }, ...children);
  }

  if (entry.pending === null) {
    return null;
  }

  if (entry.pending !== undefined) {
    return React.createElement(entry.pending, { ...node.attributes, key, node }, ...children);
  }

  const Pending = registry?.pending.jsx;

  return Pending === undefined ? null : (
    <Pending key={key} name={node.name} node={node} props={node.attributes}>
      {children}
    </Pending>
  );
}

/**
 * Splits growing code into groups of up to four lines. Settled groups keep their
 * text nodes, so the DOM only updates the open group.
 */
function lineGroups(value: string): readonly string[] {
  return value.match(/(?:[^\n]*\n){1,4}|[^\n]+$/gu) ?? [];
}
