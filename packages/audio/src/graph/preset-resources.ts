import { isObject, isString } from "@temelj/value";

import type { AudioSourceCandidate, AudioSourceSelectionOptions } from "../buffer/loading.ts";
import type { AudioContextLike } from "../context/context.ts";
import type { GraphPresetValue } from "./snapshot.ts";

import { loadAudio, resolveAudioUrl } from "../buffer/loading.ts";
import { AudioGraphError, AudioUnsupportedError } from "../errors.ts";
import { isAudioBufferValue } from "../guards.ts";

export const GRAPH_PRESET_RESOURCE_KINDS = [
  "audioBuffer",
  "mediaElement",
  "mediaStream",
  "mediaStreamTrack",
] as const;

export type GraphPresetResourceKind = (typeof GRAPH_PRESET_RESOURCE_KINDS)[number];

type ResourceValues = {
  readonly audioBuffer: AudioBuffer;
  readonly mediaElement: HTMLMediaElement;
  readonly mediaStream: MediaStream;
  readonly mediaStreamTrack: MediaStreamTrack;
};

/**
 * Runtime values referenced from a preset, keyed by resource kind and then by resource id.
 */
export type GraphPresetResources = {
  readonly [Kind in GraphPresetResourceKind]?: ReadonlyMap<string, ResourceValues[Kind]>;
};

/**
 * Placeholder stored in a preset for a runtime-only value.
 */
export type GraphPresetResourceReference = {
  readonly type: "TemeljAudioResource";
  readonly kind: GraphPresetResourceKind;
  readonly id: string;
};

/**
 * What a resource id can resolve to: the value itself, or a source to build it from. Audio buffer
 * sources are loaded and decoded. A string or URL for a media element becomes its `src`, and a
 * string for a stream or track goes to the matching `create*` factory option.
 */
type ResourceSources = {
  readonly audioBuffer: AudioBuffer | AudioSourceCandidate | readonly AudioSourceCandidate[];
  readonly mediaElement: HTMLMediaElement | string | URL;
  readonly mediaStream: MediaStream | string;
  readonly mediaStreamTrack: MediaStreamTrack | string;
};

export type GraphPresetResourceResolver<Kind extends GraphPresetResourceKind> = (
  id: string,
) => ResourceSources[Kind] | undefined | Promise<ResourceSources[Kind] | undefined>;

export type LoadGraphPresetResourcesOptions = AudioSourceSelectionOptions & {
  /**
   * Resource sources by kind and id.
   */
  readonly sources?: {
    readonly [Kind in GraphPresetResourceKind]?: Readonly<Record<string, ResourceSources[Kind]>>;
  };
  /**
   * Fallback resolvers for ids missing from `sources`.
   */
  readonly resolvers?: {
    readonly [Kind in GraphPresetResourceKind]?: GraphPresetResourceResolver<Kind>;
  };
  readonly createMediaElement?: (src: string) => HTMLMediaElement;
  readonly createMediaStream?: (id: string) => MediaStream;
  readonly createMediaStreamTrack?: (id: string) => MediaStreamTrack;
  /**
   * Skip references that cannot be resolved instead of throwing.
   */
  readonly optional?: boolean;
};

export type GraphPresetResourceReferences = {
  readonly [Kind in GraphPresetResourceKind]: readonly string[];
};

/**
 * Creates the JSON reference that stands in for a runtime resource (such as an `AudioBuffer`) of
 * `kind` in a preset.
 */
export function createGraphPresetResourceReference(
  kind: GraphPresetResourceKind,
  id: string,
): GraphPresetResourceReference {
  return { id, kind, type: "TemeljAudioResource" };
}

/**
 * Returns whether `value` is a resource reference created by
 * `createGraphPresetResourceReference()`.
 */
export function isGraphPresetResourceReference(
  value: unknown,
): value is GraphPresetResourceReference {
  return (
    isObject(value) &&
    "type" in value &&
    value.type === "TemeljAudioResource" &&
    "id" in value &&
    isString(value.id) &&
    "kind" in value &&
    GRAPH_PRESET_RESOURCE_KINDS.some((kind) => kind === value.kind)
  );
}

function visitValues(value: GraphPresetValue, visit: (value: GraphPresetValue) => void): void {
  visit(value);

  if (Array.isArray(value)) {
    for (const entry of value) {
      visitValues(entry, visit);
    }
  } else if (isObject(value)) {
    for (const entry of Object.values(value)) {
      visitValues(entry, visit);
    }
  }
}

/**
 * Returns the sorted resource ids referenced by preset node options and metadata.
 */
export function collectGraphPresetResourceReferences(
  values: Iterable<GraphPresetValue>,
): GraphPresetResourceReferences {
  const ids = new Map<GraphPresetResourceKind, Set<string>>(
    GRAPH_PRESET_RESOURCE_KINDS.map((kind) => [kind, new Set()]),
  );

  for (const root of values) {
    visitValues(root, (value) => {
      if (isGraphPresetResourceReference(value)) {
        ids.get(value.kind)?.add(value.id);
      }
    });
  }

  const sorted = (kind: GraphPresetResourceKind): readonly string[] =>
    [...(ids.get(kind) ?? [])].sort();

  return {
    audioBuffer: sorted("audioBuffer"),
    mediaElement: sorted("mediaElement"),
    mediaStream: sorted("mediaStream"),
    mediaStreamTrack: sorted("mediaStreamTrack"),
  };
}

/**
 * Returns the reference for a runtime value that appears in `resources`.
 */
export function findGraphPresetResourceReference(
  value: unknown,
  resources: GraphPresetResources,
): GraphPresetResourceReference | undefined {
  for (const kind of GRAPH_PRESET_RESOURCE_KINDS) {
    for (const [id, resource] of resources[kind] ?? []) {
      if (resource === value) {
        return createGraphPresetResourceReference(kind, id);
      }
    }
  }

  return undefined;
}

export function getGraphPresetResource(
  reference: GraphPresetResourceReference,
  resources: GraphPresetResources,
): ResourceValues[GraphPresetResourceKind] {
  const resource = resources[reference.kind]?.get(reference.id);

  if (resource === undefined) {
    return AudioGraphError.missingResource(reference.kind, reference.id);
  }

  return resource;
}

function createMediaElement(
  src: string,
  options: LoadGraphPresetResourcesOptions,
): HTMLMediaElement {
  if (options.createMediaElement !== undefined) {
    return options.createMediaElement(src);
  }

  if (globalThis.Audio === undefined) {
    return AudioUnsupportedError.missingApi("HTMLAudioElement");
  }

  return new Audio(src);
}

function createFromFactory<Value>(
  id: string,
  factory: ((id: string) => Value) | undefined,
  api: string,
): Value {
  if (factory === undefined) {
    return AudioUnsupportedError.missingApi(`${api} factory`);
  }

  return factory(id);
}

type ResourceLoaders = {
  readonly [Kind in GraphPresetResourceKind]: (
    context: AudioContextLike,
    source: ResourceSources[Kind],
    options: LoadGraphPresetResourcesOptions,
  ) => ResourceValues[Kind] | Promise<ResourceValues[Kind]>;
};

const RESOURCE_LOADERS: ResourceLoaders = {
  audioBuffer: (context, source, options) =>
    isAudioBufferValue(source) ? source : loadAudio(context, source, options),
  mediaElement: (_context, source, options) =>
    isString(source) || source instanceof URL
      ? createMediaElement(resolveAudioUrl(String(source), options.baseUrl), options)
      : source,
  mediaStream: (_context, source, options) =>
    isString(source) ? createFromFactory(source, options.createMediaStream, "MediaStream") : source,
  mediaStreamTrack: (_context, source, options) =>
    isString(source)
      ? createFromFactory(source, options.createMediaStreamTrack, "MediaStreamTrack")
      : source,
};

async function loadResourcesOfKind<Kind extends GraphPresetResourceKind>(
  context: AudioContextLike,
  kind: Kind,
  ids: readonly string[],
  options: LoadGraphPresetResourcesOptions,
): Promise<ReadonlyMap<string, ResourceValues[Kind]>> {
  const load: ResourceLoaders[Kind] = RESOURCE_LOADERS[kind];
  const resolve: GraphPresetResourceResolver<Kind> | undefined = options.resolvers?.[kind];

  const sources: Readonly<Record<string, ResourceSources[Kind]>> | undefined =
    options.sources?.[kind];

  const entries = await Promise.all(
    ids.map(async (id): Promise<readonly [string, ResourceValues[Kind]] | undefined> => {
      const source = sources?.[id] ?? (await resolve?.(id));

      if (source === undefined) {
        return options.optional === true ? undefined : AudioGraphError.missingResource(kind, id);
      }

      return [id, await load(context, source, options)];
    }),
  );

  return new Map(entries.filter((entry) => entry !== undefined));
}

/**
 * Loads every resource referenced by `values` from `options.sources` or `options.resolvers`.
 *
 * @throws {AudioGraphError} When a reference cannot be resolved and `optional` is not set.
 */
export async function loadGraphPresetResources(
  context: AudioContextLike,
  values: Iterable<GraphPresetValue>,
  options: LoadGraphPresetResourcesOptions = {},
): Promise<GraphPresetResources> {
  const references = collectGraphPresetResourceReferences(values);

  const [audioBuffer, mediaElement, mediaStream, mediaStreamTrack] = await Promise.all([
    loadResourcesOfKind(context, "audioBuffer", references.audioBuffer, options),
    loadResourcesOfKind(context, "mediaElement", references.mediaElement, options),
    loadResourcesOfKind(context, "mediaStream", references.mediaStream, options),
    loadResourcesOfKind(context, "mediaStreamTrack", references.mediaStreamTrack, options),
  ]);

  return { audioBuffer, mediaElement, mediaStream, mediaStreamTrack };
}
