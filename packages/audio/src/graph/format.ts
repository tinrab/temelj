import { isNumber, isObject, isString } from "@temelj/value";

import type { GraphEdge, GraphNode } from "./snapshot.ts";

export function compareEdges(left: GraphEdge, right: GraphEdge): number {
  return (
    left.from.localeCompare(right.from) ||
    left.to.localeCompare(right.to) ||
    (left.param ?? "").localeCompare(right.param ?? "") ||
    (left.output ?? -1) - (right.output ?? -1) ||
    (left.input ?? -1) - (right.input ?? -1)
  );
}

export function compareNodes(left: GraphNode, right: GraphNode): number {
  return left.id.localeCompare(right.id);
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Serializes arbitrary blueprint options for display and diffing.
export function stableStringify(value: unknown): string {
  if (!isObject(value)) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));

  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

export function edgeToString(edge: GraphEdge): string {
  const output = isNumber(edge.output) ? `:${edge.output}` : "";
  const input = isNumber(edge.input) ? `:${edge.input}` : "";
  const target = isString(edge.param) ? `${edge.to}.${edge.param}` : edge.to;

  return `${edge.from}${output} -> ${target}${input}`;
}

export function edgeLabel(edge: GraphEdge): string | undefined {
  const parts: string[] = [];

  if (isNumber(edge.output)) {
    parts.push(`out ${edge.output}`);
  }

  if (isNumber(edge.input)) {
    parts.push(`in ${edge.input}`);
  }

  if (isString(edge.param)) {
    parts.push(edge.param);
  }

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join(" / ");
}

export function diffNodeToString(node: GraphNode): string {
  const details = [
    `type=${node.type}`,
    node.options === undefined ? undefined : `options=${stableStringify(node.options)}`,
    node.metadata === undefined ? undefined : `metadata=${stableStringify(node.metadata)}`,
  ].filter((detail): detail is string => isString(detail));

  return `${node.id} (${details.join(", ")})`;
}
