import { isNumber } from "@temelj/value";

import type { Connectable } from "./blueprint.ts";

import { SignalBlueprint } from "../signal/signal.ts";
import { Blueprint, BlueprintParam, getConnectableOwner } from "./blueprint.ts";
import { compareEdges } from "./format.ts";

/**
 * JSON-compatible value used for snapshot node metadata and for preset node options and metadata.
 * `undefined` stands for an absent field.
 */
export type GraphPresetValue =
  | boolean
  | null
  | number
  | string
  | undefined
  | readonly GraphPresetValue[]
  | { readonly [key: string]: GraphPresetValue };

export type GraphNode = {
  /**
   * Stable id of the form `type:index`, numbered per type in inspection order.
   */
  readonly id: string;
  readonly type: string;
  readonly options: unknown;
  readonly metadata?: GraphPresetValue;
};

export type GraphEdge = {
  readonly from: string;
  readonly to: string;
  readonly output?: number;
  readonly input?: number;
  /**
   * Target `AudioParam` name when the edge modulates a param.
   */
  readonly param?: string;
};

export type GraphSnapshot = {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
};

export type GraphMermaidDirection = "BT" | "LR" | "RL" | "TB";

/**
 * Returns every blueprint connected to `roots`, following connections in both directions.
 */
export function collectConnectedBlueprints(roots: readonly Blueprint[]): Blueprint[] {
  const visited = new Set<Blueprint>();
  const pending = [...roots];

  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (visited.has(node)) {
      continue;
    }

    visited.add(node);

    for (const connection of node.outgoing) {
      pending.push(getConnectableOwner(connection.destination));
    }

    for (const connection of node.incoming) {
      pending.push(connection.source);
    }
  }

  return [...visited];
}

function createIds(blueprints: readonly Blueprint[]): Map<Blueprint, string> {
  const counts = new Map<string, number>();
  const ids = new Map<Blueprint, string>();

  for (const blueprint of blueprints) {
    const count = (counts.get(blueprint.type) ?? 0) + 1;
    counts.set(blueprint.type, count);
    ids.set(blueprint, `${blueprint.type}:${count}`);
  }

  return ids;
}

function getSignalMetadata(blueprint: Blueprint): GraphPresetValue {
  if (!(blueprint instanceof SignalBlueprint)) {
    return undefined;
  }

  const sources = blueprint.sources.filter((source) => isNumber(source));

  if (sources.length !== blueprint.sources.length) {
    return undefined;
  }

  return { operation: blueprint.operation, sources };
}

/**
 * Composite parts as node ids, so hydration can hand the same parts back to the composite.
 */
function getPartsMetadata(
  blueprint: Blueprint,
  ids: ReadonlyMap<Blueprint, string>,
): GraphPresetValue {
  const { parts } = blueprint;

  if (parts === undefined) {
    return undefined;
  }

  const idOf = (part: Blueprint): string => ids.get(part) ?? "";

  return Object.fromEntries(
    Object.entries(parts).map(([role, part]) => [
      role,
      part instanceof Blueprint ? idOf(part) : part.map(idOf),
    ]),
  );
}

function getNodeMetadata(
  blueprint: Blueprint,
  ids: ReadonlyMap<Blueprint, string>,
): GraphPresetValue {
  const parts = getPartsMetadata(blueprint, ids);

  return parts === undefined ? getSignalMetadata(blueprint) : { parts };
}

function createNode(
  blueprint: Blueprint,
  id: string,
  ids: ReadonlyMap<Blueprint, string>,
): GraphNode {
  const metadata = getNodeMetadata(blueprint, ids);
  const node: GraphNode = { id, options: blueprint.options, type: blueprint.type };

  return metadata === undefined ? node : { ...node, metadata };
}

function createEdge(
  from: string,
  to: string,
  destination: Connectable,
  output: number | undefined,
  input: number | undefined,
): GraphEdge {
  const outputField = output === undefined ? {} : { output };

  if (destination instanceof BlueprintParam) {
    return { from, to, ...outputField, param: destination.key };
  }

  return input === undefined ? { from, to, ...outputField } : { from, to, ...outputField, input };
}

/**
 * Describes the graph connected to `roots` as plain nodes and edges.
 */
export function inspectGraph(roots: readonly Blueprint[]): GraphSnapshot {
  const blueprints = collectConnectedBlueprints(roots).sort((left, right) =>
    left.type.localeCompare(right.type),
  );

  const ids = createIds(blueprints);
  const edges: GraphEdge[] = [];

  for (const blueprint of blueprints) {
    const from = ids.get(blueprint);

    for (const { destination, output, input } of blueprint.outgoing) {
      const to = ids.get(getConnectableOwner(destination));

      if (from !== undefined && to !== undefined) {
        edges.push(createEdge(from, to, destination, output, input));
      }
    }
  }

  return {
    edges: edges.sort(compareEdges),
    nodes: blueprints.map((blueprint) => createNode(blueprint, ids.get(blueprint) ?? "", ids)),
  };
}
