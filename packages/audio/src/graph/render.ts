import { isString } from "@temelj/value";

import type { GraphMermaidDirection, GraphNode, GraphSnapshot } from "./snapshot.ts";

import { compareEdges, compareNodes, stableStringify, edgeToString, edgeLabel } from "./format.ts";

/**
 * Formats a snapshot as readable text with one line per edge. Nodes without edges are left out,
 * except that a snapshot with no edges at all lists its node ids.
 */
export function graphSnapshotToString(snapshot: GraphSnapshot): string {
  if (snapshot.edges.length === 0) {
    return snapshot.nodes.map((node) => node.id).join("\n");
  }

  return snapshot.edges.map((edge) => edgeToString(edge)).join("\n");
}

/**
 * Formats a snapshot as a Graphviz DOT digraph named `graphName`.
 */
export function graphSnapshotToDot(snapshot: GraphSnapshot, graphName = "AudioGraph"): string {
  const lines = [`digraph ${escapeDotString(graphName)} {`, "  rankdir=LR;"];

  for (const node of [...snapshot.nodes].sort(compareNodes)) {
    lines.push(
      `  ${dotNodeId(node.id)}${formatDotAttributes({
        label: nodeLabel(node, "\\n"),
        // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Graphviz names this node attribute `shape`.
        shape: "box",
      })};`,
    );
  }

  for (const edge of [...snapshot.edges].sort(compareEdges)) {
    lines.push(
      `  ${dotNodeId(edge.from)} -> ${dotNodeId(edge.to)}${formatDotAttributes({
        label: edgeLabel(edge),
      })};`,
    );
  }

  lines.push("}");

  return lines.join("\n");
}

/**
 * Formats a snapshot as a Mermaid flowchart laid out in `direction`.
 */
export function graphSnapshotToMermaid(
  snapshot: GraphSnapshot,
  direction: GraphMermaidDirection = "LR",
): string {
  const nodeIds = createMermaidNodeIds(snapshot.nodes);
  const lines = [`flowchart ${direction}`];

  for (const node of [...snapshot.nodes].sort(compareNodes)) {
    const nodeId = nodeIds.get(node.id);

    if (!nodeId) {
      continue;
    }

    lines.push(`  ${nodeId}["${escapeMermaidString(nodeLabel(node))}"]`);
  }

  for (const edge of [...snapshot.edges].sort(compareEdges)) {
    const from = nodeIds.get(edge.from);
    const to = nodeIds.get(edge.to);

    if (!from || !to) {
      continue;
    }

    const label = edgeLabel(edge);

    if (label) {
      lines.push(`  ${from} -->|"${escapeMermaidString(label)}"| ${to}`);
      continue;
    }

    lines.push(`  ${from} --> ${to}`);
  }

  return lines.join("\n");
}

function escapeDotString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
}

function dotNodeId(id: string): string {
  return `"${escapeDotString(id)}"`;
}

function formatDotAttributes(attributes: Readonly<Record<string, string | undefined>>): string {
  const entries = Object.entries(attributes).filter((entry): entry is [string, string] => {
    return isString(entry[1]);
  });

  if (entries.length === 0) {
    return "";
  }

  return ` [${entries.map(([key, value]) => `${key}="${escapeDotString(value)}"`).join(", ")}]`;
}

function nodeLabel(node: GraphNode, separator = "\n"): string {
  if (node.metadata === undefined) {
    return `${node.id}${separator}${node.type}`;
  }

  return `${node.id}${separator}${node.type}${separator}metadata: ${stableStringify(node.metadata)}`;
}

function escapeMermaidString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', "#quot;").replaceAll("\n", "<br/>");
}

function createMermaidNodeIds(nodes: readonly GraphNode[]): Map<string, string> {
  const ids = new Map<string, string>();

  for (const [index, node] of [...nodes].sort(compareNodes).entries()) {
    ids.set(node.id, `n${index + 1}`);
  }

  return ids;
}
