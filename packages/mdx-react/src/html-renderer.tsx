import type {
  HtmlElementNode,
  HtmlJsxNode,
  HtmlNode,
  HtmlPendingNode,
  HtmlUnresolvedReferenceNode,
} from "@temelj/mdx";

import { htmlFallback, htmlText, pendingFallback } from "@temelj/mdx";
import { isObject } from "@temelj/value";
import React from "react";

import type { MdxRegistry } from "./registry.ts";
import type { MdxElementComponentNode, MdxJsxComponentNode, MdxLiteralPropValue } from "./types.ts";

import { reactAttributes } from "./react-attributes.ts";
import { reservedMdxProps } from "./types.ts";

const reservedProps: ReadonlySet<string> = new Set(reservedMdxProps);

/**
 * Rendered elements by node identity. Trees are immutable, so a node that kept
 * its identity across stream updates reuses its element and React skips it.
 */
export type RenderCache = WeakMap<HtmlNode, Readonly<{ key: React.Key; element: React.ReactNode }>>;

interface RenderContext {
  readonly registry: MdxRegistry | undefined;
  readonly cache: RenderCache | undefined;
}

/** Renders lowered HTML. Hook-free, so it also runs in React Server Components. */
export function renderHtmlNodes(
  nodes: readonly HtmlNode[],
  registry: MdxRegistry | undefined,
  cache?: RenderCache,
): React.ReactNode[] {
  return renderNodes(nodes, { registry, cache }, false);
}

export function renderHtmlNode(
  node: HtmlNode,
  registry: MdxRegistry | undefined,
  key: React.Key,
): React.ReactNode {
  return renderNode(node, { registry, cache: undefined }, key, false);
}

function renderNodes(
  nodes: readonly HtmlNode[],
  context: RenderContext,
  inSvg: boolean,
): React.ReactNode[] {
  return nodes.map((node, index) => renderNode(node, context, index, inSvg));
}

function renderNode(
  node: HtmlNode,
  context: RenderContext,
  key: React.Key,
  inSvg: boolean,
): React.ReactNode {
  const cached = context.cache?.get(node);

  if (cached !== undefined && cached.key === key) {
    return cached.element;
  }

  const element = renderNodeCore(node, context, key, inSvg);
  context.cache?.set(node, { key, element });

  return element;
}

function renderNodeCore(
  node: HtmlNode,
  context: RenderContext,
  key: React.Key,
  inSvg: boolean,
): React.ReactNode {
  switch (node.kind) {
    case "text":
    case "raw":
      return node.value;
    case "expression":
      return node.fallback;
    case "comment":
    case "doctype":
      return null;
    case "root":
      return (
        <React.Fragment key={key}>{renderNodes(node.children, context, inSvg)}</React.Fragment>
      );
    case "jsx":
      return node.state === "complete"
        ? renderJsx(node, context, key)
        : renderPendingJsx(node, context, key);
    case "element":
      return renderElement(node, context, key, inSvg);
    case "codeBlock": {
      const CodeBlock = context.registry?.markdown.codeBlock;

      return CodeBlock === undefined ? (
        renderElement({ ...htmlFallback(node), origin: node.origin }, context, key, inSvg)
      ) : (
        <CodeBlock
          code={node.code}
          key={key}
          language={node.language}
          meta={node.meta}
          node={node}
          status="complete"
        />
      );
    }

    case "math": {
      const Math = context.registry?.math;

      return Math === undefined ? (
        renderElement(htmlFallback(node), context, key, inSvg)
      ) : (
        <Math key={key} meta={node.meta} source={node.source} style={node.style} />
      );
    }

    case "footnoteReference":
    case "footnoteSection":
      return renderElement({ ...htmlFallback(node), origin: node.origin }, context, key, inSvg);
    case "pending":
    case "unresolvedReference":
      return renderPending(node, context, key, inSvg);
    default: {
      const exhaustive: never = node;

      return exhaustive;
    }
  }
}

function renderElement(
  node: HtmlElementNode,
  context: RenderContext,
  key: React.Key,
  inSvg: boolean,
): React.ReactNode {
  const svg = inSvg || node.tagName === "svg";
  const children = renderNodes(node.children, context, svg && node.tagName !== "foreignObject");

  return createMdxElement(node, context.registry, key, svg, children);
}

/** Creates an element through its `html` override or as an intrinsic element. */
function createMdxElement(
  node: Pick<HtmlElementNode, "attributes" | "origin" | "tagName">,
  registry: MdxRegistry | undefined,
  key: React.Key,
  svg: boolean,
  children: readonly React.ReactNode[],
): React.ReactNode {
  const attributes = reactAttributes(node.attributes, svg);

  const custom =
    registry !== undefined && Object.hasOwn(registry.html, node.tagName)
      ? registry.html[node.tagName]
      : undefined;

  if (custom === undefined) {
    return React.createElement(node.tagName, { ...attributes, key }, ...children);
  }

  const component: MdxElementComponentNode = {
    kind: "element",
    tagName: node.tagName,
    attributes: node.attributes,
    origin: node.origin,
  };

  return React.createElement(custom, { ...attributes, key, node: component }, ...children);
}

function renderJsx(node: HtmlJsxNode, context: RenderContext, key: React.Key): React.ReactNode {
  const { name } = node;

  const entry =
    name !== undefined &&
    context.registry !== undefined &&
    Object.hasOwn(context.registry.jsx, name)
      ? context.registry.jsx[name]
      : undefined;

  const attributes = staticJsxAttributes(node);

  if (name === undefined || entry === undefined || attributes === undefined) {
    return node.fallback;
  }

  const component: MdxJsxComponentNode = {
    kind: "jsx",
    element: node.element,
    name,
    attributes,
    origin: node.origin,
  };

  return React.createElement(
    entry.component,
    { ...attributes, key, node: component },
    ...renderNodes(node.children, context, false),
  );
}

/** Unfinished JSX renders only through a pending renderer and never invokes the component. */
function renderPendingJsx(
  node: HtmlJsxNode,
  context: RenderContext,
  key: React.Key,
): React.ReactNode {
  const { name } = node;

  const entry =
    name !== undefined &&
    context.registry !== undefined &&
    Object.hasOwn(context.registry.jsx, name)
      ? context.registry.jsx[name]
      : undefined;

  const attributes = staticJsxAttributes(node);

  if (name === undefined || entry === undefined || attributes === undefined) {
    return null;
  }

  if (entry.pending === null) {
    return null;
  }

  const children = renderNodes(node.children, context, false);

  if (entry.pending !== undefined) {
    return React.createElement(entry.pending, { ...attributes, key, node }, ...children);
  }

  const Pending = context.registry?.pending.jsx;

  return Pending === undefined ? null : (
    <Pending key={key} name={name} node={node} props={attributes}>
      {children}
    </Pending>
  );
}

/** Literal attributes, or `undefined` when an attribute could execute or override owned props. */
function staticJsxAttributes(
  node: HtmlJsxNode,
): Readonly<Record<string, MdxLiteralPropValue>> | undefined {
  const attributes: Record<string, MdxLiteralPropValue> = {};

  for (const attribute of node.attributes) {
    if (
      attribute.kind !== "jsxAttribute" ||
      isObject(attribute.value) ||
      reservedProps.has(attribute.name)
    ) {
      return undefined;
    }

    attributes[attribute.name] = attribute.value ?? true;
  }

  return attributes;
}

function renderPending(
  node: HtmlPendingNode | HtmlUnresolvedReferenceNode,
  context: RenderContext,
  key: React.Key,
  inSvg: boolean,
): React.ReactNode {
  if (node.kind === "pending" && node.construct === "fence") {
    const CodeBlock = context.registry?.markdown.codeBlock;
    const code = htmlText(node);

    if (CodeBlock !== undefined) {
      return (
        <CodeBlock
          code={code}
          key={key}
          language={node.language}
          meta={node.meta}
          node={node}
          status="pending"
        />
      );
    }

    return wrapPending(
      node,
      context,
      key,
      <pre key={key}>
        <code className={node.language === undefined ? undefined : `language-${node.language}`}>
          {lineGroups(code)}
        </code>
      </pre>,
    );
  }

  const rendered = (
    <React.Fragment key={key}>{renderNodes(pendingFallback(node), context, inSvg)}</React.Fragment>
  );

  return node.kind === "pending" &&
    (node.construct === "expression" ||
      node.construct === "esm" ||
      node.construct === "jsx" ||
      node.construct === "inlineMath" ||
      node.construct === "displayMath")
    ? rendered
    : wrapPending(node, context, key, rendered);
}

/** Open Markdown and unresolved references go through the registry's pending renderer. */
function wrapPending(
  node: HtmlPendingNode | HtmlUnresolvedReferenceNode,
  context: RenderContext,
  key: React.Key,
  rendered: React.ReactNode,
): React.ReactNode {
  const Pending = context.registry?.pending.markdown;

  return Pending === undefined ? (
    rendered
  ) : (
    <Pending key={key} node={node}>
      {rendered}
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
