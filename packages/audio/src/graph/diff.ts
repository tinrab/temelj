import { isNumber } from "@temelj/value";

import type { Blueprint } from "./blueprint.ts";
import type { GraphEdge, GraphNode, GraphSnapshot } from "./snapshot.ts";

import { AudioDisposedError } from "../errors.ts";
import {
  compareEdges,
  compareNodes,
  stableStringify,
  edgeToString,
  diffNodeToString,
} from "./format.ts";
import { inspectGraph } from "./snapshot.ts";

export type GraphDiff = {
  readonly addedEdges: readonly GraphEdge[];
  readonly addedNodes: readonly GraphNode[];
  readonly removedEdges: readonly GraphEdge[];
  readonly removedNodes: readonly GraphNode[];
  readonly updatedNodes: readonly GraphNodeUpdate[];
};

export type GraphNodeUpdate = {
  readonly after: GraphNode;
  readonly before: GraphNode;
};

/**
 * Compares two snapshots. Nodes are matched by id, and edges match only when every field is equal.
 */
export function diffGraphSnapshots(before: GraphSnapshot, after: GraphSnapshot): GraphDiff {
  const beforeNodes = new Map(before.nodes.map((node) => [node.id, node]));
  const afterNodes = new Map(after.nodes.map((node) => [node.id, node]));
  const beforeEdges = new Map(before.edges.map((edge) => [edgeKey(edge), edge]));
  const afterEdges = new Map(after.edges.map((edge) => [edgeKey(edge), edge]));

  const addedNodes: GraphNode[] = [];
  const removedNodes: GraphNode[] = [];
  const updatedNodes: GraphNodeUpdate[] = [];
  const addedEdges: GraphEdge[] = [];
  const removedEdges: GraphEdge[] = [];

  for (const node of after.nodes) {
    const previous = beforeNodes.get(node.id);

    if (!previous) {
      addedNodes.push(node);
      continue;
    }

    if (nodeChanged(previous, node)) {
      updatedNodes.push({ after: node, before: previous });
    }
  }

  for (const node of before.nodes) {
    if (!afterNodes.has(node.id)) {
      removedNodes.push(node);
    }
  }

  for (const edge of after.edges) {
    if (!beforeEdges.has(edgeKey(edge))) {
      addedEdges.push(edge);
    }
  }

  for (const edge of before.edges) {
    if (!afterEdges.has(edgeKey(edge))) {
      removedEdges.push(edge);
    }
  }

  return {
    addedEdges: addedEdges.sort(compareEdges),
    addedNodes: addedNodes.sort(compareNodes),
    removedEdges: removedEdges.sort(compareEdges),
    removedNodes: removedNodes.sort(compareNodes),
    updatedNodes: updatedNodes.sort((left, right) => left.before.id.localeCompare(right.before.id)),
  };
}

/**
 * Formats a graph diff as readable text, one change per line.
 */
export function graphDiffToString(diff: GraphDiff): string {
  const lines: string[] = [];

  for (const node of diff.addedNodes) {
    lines.push(`+ node ${diffNodeToString(node)}`);
  }

  for (const node of diff.removedNodes) {
    lines.push(`- node ${diffNodeToString(node)}`);
  }

  for (const update of diff.updatedNodes) {
    lines.push(
      `~ node ${update.before.id} ${stableStringify({
        after: update.after,
        before: update.before,
      })}`,
    );
  }

  for (const edge of diff.addedEdges) {
    lines.push(`+ edge ${edgeToString(edge)}`);
  }

  for (const edge of diff.removedEdges) {
    lines.push(`- edge ${edgeToString(edge)}`);
  }

  return lines.length === 0 ? "No graph changes" : lines.join("\n");
}

function edgeKey(edge: GraphEdge): string {
  const output = isNumber(edge.output) ? edge.output : "";
  const input = isNumber(edge.input) ? edge.input : "";
  const param = edge.param ?? "";

  return `${edge.from}|${edge.to}|${param}|${output}|${input}`;
}

function nodeChanged(left: GraphNode, right: GraphNode): boolean {
  return (
    left.type !== right.type ||
    stableStringify(left.options) !== stableStringify(right.options) ||
    stableStringify(left.metadata) !== stableStringify(right.metadata)
  );
}

/**
 * Inspects both graphs and compares their snapshots. See `diffGraphSnapshots()`.
 */
export function diffGraphs(before: readonly Blueprint[], after: readonly Blueprint[]): GraphDiff {
  return diffGraphSnapshots(inspectGraph(before), inspectGraph(after));
}

export type GraphInspectionEvent = {
  readonly diff: GraphDiff;
  readonly previous: GraphSnapshot;
  readonly snapshot: GraphSnapshot;
};

export type GraphInspectionCallback = (event: GraphInspectionEvent) => void;

/**
 * Tracks how the graph connected to a set of roots changes between `refresh()` calls.
 */
export class GraphInspectionSession {
  readonly #callbacks = new Set<GraphInspectionCallback>();
  #roots: readonly Blueprint[];
  #event: GraphInspectionEvent;
  #disposed = false;

  constructor(roots: readonly Blueprint[]) {
    this.#roots = roots;
    const snapshot = inspectGraph(roots);
    this.#event = { diff: diffGraphSnapshots(snapshot, snapshot), previous: snapshot, snapshot };
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get roots(): readonly Blueprint[] {
    return this.#roots;
  }

  get snapshot(): GraphSnapshot {
    return this.#event.snapshot;
  }

  get previous(): GraphSnapshot {
    return this.#event.previous;
  }

  get diff(): GraphDiff {
    return this.#event.diff;
  }

  /**
   * Registers a callback for every `refresh()` and returns a function that removes it.
   */
  onChange(callback: GraphInspectionCallback): () => void {
    this.#assertUsable();
    this.#callbacks.add(callback);

    return () => {
      this.#callbacks.delete(callback);
    };
  }

  refresh(roots: readonly Blueprint[] = this.#roots): GraphInspectionEvent {
    this.#assertUsable();
    this.#roots = roots;
    const previous = this.#event.snapshot;
    const snapshot = inspectGraph(roots);
    this.#event = { diff: diffGraphSnapshots(previous, snapshot), previous, snapshot };

    for (const callback of this.#callbacks) {
      callback(this.#event);
    }

    return this.#event;
  }

  dispose(): void {
    this.#callbacks.clear();
    this.#disposed = true;
  }

  #assertUsable(): void {
    if (this.#disposed) {
      AudioDisposedError.disposed("graph inspection session");
    }
  }
}
