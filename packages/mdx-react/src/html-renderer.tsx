import type { HtmlElementNode, HtmlJsxNode, HtmlNode } from "@temelj/mdx";

import { htmlFallback } from "@temelj/mdx";
import { isObject } from "@temelj/value";
import React from "react";

import type { MdxRegistry } from "./registry.ts";
import type { MdxElementComponentNode, MdxJsxComponentNode, MdxLiteralPropValue } from "./types.ts";

import { reactAttributes } from "./react-attributes.ts";
import { reservedMdxProps } from "./types.ts";

const reservedProps: ReadonlySet<string> = new Set(reservedMdxProps);

/** Renders lowered HTML. Hook-free, so it also runs in React Server Components. */
export function renderHtmlNodes(
  nodes: readonly HtmlNode[],
  registry: MdxRegistry | undefined,
  inSvg = false,
): React.ReactNode[] {
  return nodes.map((node, index) => renderHtmlNode(node, registry, index, inSvg));
}

export function renderHtmlNode(
  node: HtmlNode,
  registry: MdxRegistry | undefined,
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
        <React.Fragment key={key}>{renderHtmlNodes(node.children, registry, inSvg)}</React.Fragment>
      );
    case "jsx":
      return renderJsx(node, registry, key);
    case "element":
      return renderElement(node, registry, key, inSvg);
    case "codeBlock": {
      const CodeBlock = registry?.markdown.codeBlock;

      return CodeBlock === undefined ? (
        renderElement({ ...htmlFallback(node), origin: node.origin }, registry, key, inSvg)
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
      const Math = registry?.math;

      return Math === undefined ? (
        renderElement(htmlFallback(node), registry, key, inSvg)
      ) : (
        <Math key={key} meta={node.meta} source={node.source} style={node.style} />
      );
    }

    case "footnoteReference":
    case "footnoteSection":
      return renderElement({ ...htmlFallback(node), origin: node.origin }, registry, key, inSvg);
    default: {
      const exhaustive: never = node;

      return exhaustive;
    }
  }
}

function renderElement(
  node: HtmlElementNode,
  registry: MdxRegistry | undefined,
  key: React.Key,
  inSvg: boolean,
): React.ReactNode {
  const svg = inSvg || node.tagName === "svg";

  const children = renderHtmlNodes(
    node.children,
    registry,
    svg && node.tagName !== "foreignObject",
  );

  return createMdxElement(node, registry, key, svg, children);
}

/** Creates an element through its `html` override or as an intrinsic element. */
export function createMdxElement(
  node: Pick<HtmlElementNode, "attributes" | "origin" | "tagName">,
  registry: MdxRegistry | undefined,
  key: React.Key,
  svg: boolean,
  children: readonly React.ReactNode[],
): React.ReactNode {
  const attributes = reactAttributes(node.attributes, svg);
  const custom = registry?.html[node.tagName];

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

function renderJsx(
  node: HtmlJsxNode,
  registry: MdxRegistry | undefined,
  key: React.Key,
): React.ReactNode {
  const name = node.node.name;
  const entry = name === undefined ? undefined : registry?.jsx[name];
  const attributes = staticJsxAttributes(node);

  if (name === undefined || entry === undefined || attributes === undefined) {
    return node.fallback;
  }

  const component: MdxJsxComponentNode = {
    kind: node.node.kind,
    name,
    attributes,
    origin: node.node.origin,
  };

  return React.createElement(
    entry.component,
    { ...attributes, key, node: component },
    ...renderHtmlNodes(node.children, registry),
  );
}

/** Literal attributes, or `undefined` when an attribute could execute or override owned props. */
function staticJsxAttributes(
  node: HtmlJsxNode,
): Readonly<Record<string, MdxLiteralPropValue>> | undefined {
  const attributes: Record<string, MdxLiteralPropValue> = {};

  for (const attribute of node.node.attributes) {
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
