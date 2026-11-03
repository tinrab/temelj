import { isBoolean, isNumber, isObject, isPlainObject, isString } from "@temelj/value";
import { z } from "zod";

import type { AudioContextLike } from "../context/context.ts";
import type { Blueprint, BlueprintParts } from "./blueprint.ts";
import type { GraphEdge, GraphNode, GraphPresetValue, GraphSnapshot } from "./snapshot.ts";

import { AudioGraphError } from "../errors.ts";
import {
  findGraphPresetResourceReference,
  getGraphPresetResource,
  isGraphPresetResourceReference,
  loadGraphPresetResources,
  type GraphPresetResources,
  type LoadGraphPresetResourcesOptions,
} from "./preset-resources.ts";
import { hydrateBlueprint } from "./registry.ts";

/**
 * JSON value as stored in a preset.
 */
export type GraphPresetJson =
  | boolean
  | null
  | number
  | string
  | readonly GraphPresetJson[]
  | { readonly [key: string]: GraphPresetJson };

export type GraphPresetNode = {
  readonly id: string;
  readonly type: string;
  readonly options?: GraphPresetJson;
  readonly metadata?: GraphPresetJson;
};

/**
 * JSON-safe form of a graph snapshot.
 */
export type GraphPreset = {
  readonly nodes: readonly GraphPresetNode[];
  readonly edges: readonly GraphEdge[];
};

const graphPresetJsonSchema: z.ZodType<GraphPresetJson> = z.lazy(() =>
  z.union([
    z.boolean(),
    z.null(),
    z.number(),
    z.string(),
    z.array(graphPresetJsonSchema),
    z.record(z.string(), graphPresetJsonSchema),
  ]),
);

const graphPresetSchema: z.ZodType<GraphPreset> = z.strictObject({
  edges: z.array(
    z.strictObject({
      from: z.string(),
      input: z.number().int().nonnegative().optional(),
      output: z.number().int().nonnegative().optional(),
      param: z.string().optional(),
      to: z.string(),
    }),
  ),
  nodes: z.array(
    z.strictObject({
      id: z.string().min(1),
      metadata: graphPresetJsonSchema.optional(),
      options: graphPresetJsonSchema.optional(),
      type: z.string().min(1),
    }),
  ),
});

/**
 * Validates untrusted JSON as a graph preset.
 *
 * @throws {AudioGraphError} When `input` is not a valid preset; the Zod error is the cause.
 */
export function parseGraphPreset(input: unknown): GraphPreset {
  const result = graphPresetSchema.safeParse(input);

  if (!result.success) {
    return AudioGraphError.invalidPreset({ cause: result.error });
  }

  return result.data;
}

const TYPED_ARRAYS = {
  Float32Array,
  Float64Array,
  Int8Array,
  Int16Array,
  Int32Array,
  Uint8Array,
  Uint8ClampedArray,
  Uint16Array,
  Uint32Array,
} as const;

type TypedArrayName = keyof typeof TYPED_ARRAYS;

type TypedArrayValue = {
  readonly type: TypedArrayName;
  readonly data: readonly number[];
};

function isTypedArrayName(value: unknown): value is TypedArrayName {
  return isString(value) && Object.hasOwn(TYPED_ARRAYS, value);
}

// oxlint-disable-next-line anti-slop/no-object-parameters -- Type guard over objects decoded from preset JSON.
function isTypedArrayValue(value: object): value is TypedArrayValue {
  return (
    "type" in value &&
    isTypedArrayName(value.type) &&
    "data" in value &&
    Array.isArray(value.data) &&
    value.data.every((entry) => isNumber(entry))
  );
}

export type GraphPresetEncodeContext = {
  readonly node: GraphNode;
  readonly path: string;
};

export type SerializeGraphPresetOptions = {
  /**
   * Runtime values to store as resource references.
   */
  readonly resources?: GraphPresetResources;
  /**
   * Encodes values the built-in rules cannot store. Without it, such a value makes
   * `serializeGraphPreset()` throw `AudioGraphError`.
   */
  readonly encode?: (value: unknown, context: GraphPresetEncodeContext) => GraphPresetJson;
};

function encodeValue(
  value: unknown,
  context: GraphPresetEncodeContext,
  options: SerializeGraphPresetOptions,
): GraphPresetJson | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || isBoolean(value) || isString(value)) {
    return value;
  }

  if (isNumber(value)) {
    return Number.isFinite(value) ? value : AudioGraphError.notSerializable(context.path);
  }

  if (Array.isArray(value)) {
    return value.map(
      (entry, index) =>
        encodeValue(entry, { ...context, path: `${context.path}[${index}]` }, options) ?? null,
    );
  }

  const reference =
    options.resources === undefined
      ? undefined
      : findGraphPresetResourceReference(value, options.resources);

  if (reference !== undefined) {
    return reference;
  }

  for (const [name, constructor] of Object.entries(TYPED_ARRAYS)) {
    if (value instanceof constructor) {
      return { data: Array.from(value), type: name };
    }
  }

  if (isPlainObject(value)) {
    const output: Record<string, GraphPresetJson> = {};

    for (const [key, entry] of Object.entries(value)) {
      const encoded = encodeValue(entry, { ...context, path: `${context.path}.${key}` }, options);

      if (encoded !== undefined) {
        output[key] = encoded;
      }
    }

    return output;
  }

  if (options.encode !== undefined) {
    return options.encode(value, context);
  }

  return AudioGraphError.notSerializable(context.path);
}

/**
 * Converts a snapshot into a JSON-safe preset. Typed arrays are stored as `{ type, data }` and
 * values listed in `options.resources` as resource references.
 */
export function serializeGraphPreset(
  snapshot: GraphSnapshot,
  options: SerializeGraphPresetOptions = {},
): GraphPreset {
  return {
    edges: snapshot.edges.map((edge) => ({ ...edge })),
    nodes: snapshot.nodes.map((node) => {
      const nodeOptions = encodeValue(node.options, { node, path: "options" }, options);
      const metadata = encodeValue(node.metadata, { node, path: "metadata" }, options);

      return { id: node.id, metadata, options: nodeOptions, type: node.type };
    }),
  };
}

export type HydrateGraphPresetOptions = {
  /**
   * Runtime values that resource references resolve to.
   */
  readonly resources?: GraphPresetResources;
  /**
   * Decodes node options after typed arrays and resources are restored.
   */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- Decoded options are validated per node type by the registry during hydration.
  readonly decode?: (options: unknown, node: GraphPresetNode) => unknown;
};

export type GraphHydration = {
  readonly blueprints: readonly Blueprint[];
  readonly byId: ReadonlyMap<string, Blueprint>;
};

// oxlint-disable-next-line anti-slop/no-unknown-returns -- Decoded options are validated per node type by the registry during hydration.
function decodeValue(value: GraphPresetJson | undefined, resources: GraphPresetResources): unknown {
  if (Array.isArray(value)) {
    return value.map((entry: GraphPresetJson) => decodeValue(entry, resources));
  }

  if (!isObject(value)) {
    return value;
  }

  if (isGraphPresetResourceReference(value)) {
    return getGraphPresetResource(value, resources);
  }

  if (isTypedArrayValue(value)) {
    return TYPED_ARRAYS[value.type].from(value.data);
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, decodeValue(entry, resources)]),
  );
}

/**
 * Rebuilds connected blueprints from a preset.
 *
 * @throws {AudioGraphError} When the preset cannot be rebuilt. Node ids must be unique, and every
 * node needs a known type with its required options. Edges and composite parts must point to
 * existing nodes and params, and parts must not form a cycle.
 */
export function hydrateGraphPreset(
  preset: GraphPreset,
  options: HydrateGraphPresetOptions = {},
): GraphHydration {
  const resources = options.resources ?? {};
  const byId = new Map<string, Blueprint>();
  const ids = new Set<string>();

  for (const node of preset.nodes) {
    if (ids.has(node.id)) {
      AudioGraphError.duplicateNode(node.id);
    }

    ids.add(node.id);
  }

  for (const node of preset.nodes) {
    for (const id of getPartIds(node)) {
      if (!ids.has(id)) {
        AudioGraphError.missingNode(id);
      }
    }
  }

  // Composites adopt their hydrated parts, so parts are hydrated first.
  let pending = [...preset.nodes];

  while (pending.length > 0) {
    const ready = pending.filter((node) => getPartIds(node).every((id) => byId.has(id)));

    if (ready.length === 0) {
      return AudioGraphError.invalidPreset({ cause: "composite parts form a cycle" });
    }

    for (const node of ready) {
      const decoded = decodeValue(node.options, resources);
      byId.set(
        node.id,
        hydrateBlueprint({
          id: node.id,
          metadata: decodeValue(node.metadata, resources),
          options: options.decode === undefined ? decoded : options.decode(decoded, node),
          parts: resolveParts(node, byId),
          type: node.type,
        }),
      );
    }

    pending = pending.filter((node) => !ready.includes(node));
  }

  for (const edge of preset.edges) {
    const source = byId.get(edge.from) ?? AudioGraphError.missingNode(edge.from);
    const target = byId.get(edge.to) ?? AudioGraphError.missingNode(edge.to);

    if (edge.param === undefined) {
      source.connect(target, edge.output, edge.input);
      continue;
    }

    const param = target.params[edge.param] ?? AudioGraphError.missingParam(edge.to, edge.param);
    source.connect(param, edge.output);
  }

  return { blueprints: [...byId.values()], byId };
}

function getPartsRecord(
  node: GraphPresetNode,
): Readonly<Record<string, GraphPresetJson>> | undefined {
  const { metadata } = node;

  if (!isJsonObject(metadata)) {
    return undefined;
  }

  const parts = metadata["parts"];

  return isJsonObject(parts) ? parts : undefined;
}

function isJsonObject(
  value: GraphPresetJson | undefined,
): value is Readonly<Record<string, GraphPresetJson>> {
  return isPlainObject(value);
}

function getPartIds(node: GraphPresetNode): readonly string[] {
  return Object.values(getPartsRecord(node) ?? {}).flatMap((part) =>
    isString(part) ? [part] : Array.isArray(part) ? part.filter((id) => isString(id)) : [],
  );
}

function resolveParts(
  node: GraphPresetNode,
  byId: ReadonlyMap<string, Blueprint>,
): BlueprintParts | undefined {
  const parts = getPartsRecord(node);

  if (parts === undefined) {
    return undefined;
  }

  const resolve = (id: string): Blueprint => byId.get(id) ?? AudioGraphError.missingNode(id);

  return Object.fromEntries(
    Object.entries(parts).map(([role, part]) => [
      role,
      Array.isArray(part) ? part.filter((id) => isString(id)).map(resolve) : resolve(String(part)),
    ]),
  );
}

export type HydrateGraphPresetWithResourcesOptions = LoadGraphPresetResourcesOptions &
  Pick<HydrateGraphPresetOptions, "decode">;

/**
 * Loads the resources a preset references, then hydrates it.
 */
export async function hydrateGraphPresetWithResources(
  context: AudioContextLike,
  preset: GraphPreset,
  options: HydrateGraphPresetWithResourcesOptions = {},
): Promise<GraphHydration> {
  const values: GraphPresetValue[] = preset.nodes.flatMap((node) => [node.options, node.metadata]);
  const resources = await loadGraphPresetResources(context, values, options);

  return hydrateGraphPreset(preset, { decode: options.decode, resources });
}
