/* oxlint-disable anti-slop/no-shape-in-symbol-names -- `WaveShaper` is the Web Audio API name (`WaveShaperNode`, `BaseAudioContext.createWaveShaper()`). */
import { isNumber, isPlainObject } from "@temelj/value";

import type {
  BlueprintParts,
  AnalyserBlueprint,
  BiquadFilterBlueprint,
  Blueprint,
  BufferSourceBlueprint,
  ChannelMergerBlueprint,
  ChannelSplitterBlueprint,
  CompressorBlueprint,
  ConstantSourceBlueprint,
  ConvolverBlueprint,
  DelayBlueprint,
  DestinationBlueprint,
  GainBlueprint,
  GroupBlueprint,
  IIRFilterBlueprint,
  IIRFilterOptions,
  MasterBlueprint,
  MediaElementSourceBlueprint,
  MediaStreamDestinationBlueprint,
  MediaStreamSourceBlueprint,
  MediaStreamTrackSourceBlueprint,
  NoiseBlueprint,
  NoiseBlueprintOptions,
  OscillatorBlueprint,
  PannerBlueprint,
  StereoPannerBlueprint,
  WaveShaperBlueprint,
  WorkletNodeBlueprint,
} from "./blueprint.ts";

import { AudioGraphError, AudioUnsupportedError } from "../errors.ts";
import {
  createAnalyserNode,
  createAudioWorkletNode,
  createBiquadFilterNode,
  createBufferSourceNode,
  createChannelMergerNode,
  createChannelSplitterNode,
  createConstantSourceNode,
  createConvolverNode,
  createDelayNode,
  createDynamicsCompressorNode,
  createGainNode,
  createIIRFilterNode,
  createMediaElementSourceNode,
  createMediaStreamDestinationNode,
  createMediaStreamSourceNode,
  createMediaStreamTrackSourceNode,
  createOscillatorNode,
  createPannerNode,
  createStereoPannerNode,
  createWaveShaperNode,
} from "../native.ts";
import { SIGNAL_OPERATIONS, SignalBlueprint, type SignalOperation } from "../signal/signal.ts";
import { createNoiseBuffer } from "../source/noise.ts";
import {
  CrossFadeBlueprint,
  PlayerBlueprint,
  analyser,
  biquadFilter,
  bufferSource,
  channelMerger,
  channelSplitter,
  compressor,
  constantSource,
  convolver,
  delay,
  destination,
  gain,
  group,
  iirFilter,
  master,
  mediaElementSource,
  mediaStreamDestination,
  mediaStreamSource,
  mediaStreamTrackSource,
  noise,
  oscillator,
  panner,
  stereoPanner,
  waveShaper,
  workletNode,
} from "./blueprint.ts";

/**
 * Every blueprint type that `patch()` can materialize and presets can hydrate.
 */
export type KnownBlueprint =
  | AnalyserBlueprint
  | BiquadFilterBlueprint
  | BufferSourceBlueprint
  | ChannelMergerBlueprint
  | ChannelSplitterBlueprint
  | CompressorBlueprint
  | ConstantSourceBlueprint
  | ConvolverBlueprint
  | CrossFadeBlueprint
  | DelayBlueprint
  | DestinationBlueprint
  | GainBlueprint
  | GroupBlueprint
  | IIRFilterBlueprint
  | MasterBlueprint
  | MediaElementSourceBlueprint
  | MediaStreamDestinationBlueprint
  | MediaStreamSourceBlueprint
  | MediaStreamTrackSourceBlueprint
  | NoiseBlueprint
  | OscillatorBlueprint
  | PannerBlueprint
  | PlayerBlueprint
  | SignalBlueprint
  | StereoPannerBlueprint
  | WaveShaperBlueprint
  | WorkletNodeBlueprint;

export type BlueprintType = KnownBlueprint["type"];

/**
 * Native node created for each blueprint type.
 */
export type BlueprintNodeMap = {
  readonly analyser: AnalyserNode;
  readonly biquadFilter: BiquadFilterNode;
  readonly bufferSource: AudioBufferSourceNode;
  readonly channelMerger: ChannelMergerNode;
  readonly channelSplitter: ChannelSplitterNode;
  readonly compressor: DynamicsCompressorNode;
  readonly constantSource: ConstantSourceNode;
  readonly convolver: ConvolverNode;
  readonly crossFade: GainNode;
  readonly delay: DelayNode;
  readonly destination: AudioDestinationNode;
  readonly gain: GainNode;
  readonly group: GainNode;
  readonly iirFilter: IIRFilterNode;
  readonly master: GainNode;
  readonly mediaElementSource: MediaElementAudioSourceNode;
  readonly mediaStreamDestination: MediaStreamAudioDestinationNode;
  readonly mediaStreamSource: MediaStreamAudioSourceNode;
  readonly mediaStreamTrackSource: MediaStreamTrackAudioSourceNode;
  readonly noise: AudioBufferSourceNode;
  readonly oscillator: OscillatorNode;
  readonly panner: PannerNode;
  readonly player: GainNode;
  readonly signal: ConstantSourceNode | GainNode | WaveShaperNode;
  readonly stereoPanner: StereoPannerNode;
  readonly waveShaper: WaveShaperNode;
  readonly workletNode: AudioWorkletNode;
};

export type LiveNodeFor<Node extends Blueprint> = Node["type"] extends keyof BlueprintNodeMap
  ? BlueprintNodeMap[Node["type"]]
  : AudioNode;

/**
 * Serialized data a blueprint is rebuilt from. `options` and `metadata` come from a graph preset
 * that has already been decoded at the preset boundary.
 */
export type BlueprintHydration = {
  readonly id: string;
  readonly type: string;
  readonly options: unknown;
  readonly metadata: unknown;
  /**
   * Hydrated parts of a composite, by role, when the preset recorded them.
   */
  readonly parts?: BlueprintParts;
};

type BlueprintOfType<Type extends BlueprintType> = Extract<KnownBlueprint, { readonly type: Type }>;

type BlueprintDescriptor<Type extends BlueprintType> = {
  createNode(context: BaseAudioContext, blueprint: BlueprintOfType<Type>): BlueprintNodeMap[Type];
  hydrate(hydration: BlueprintHydration): BlueprintOfType<Type>;
};

/**
 * Descriptor view used for dispatch. Its methods are bivariant, so every typed descriptor is
 * assignable to it; the caller guarantees the blueprint matches the descriptor it selected.
 */
type ErasedBlueprintDescriptor = {
  createNode(context: BaseAudioContext, blueprint: KnownBlueprint): AudioNode;
  hydrate(hydration: BlueprintHydration): KnownBlueprint;
};

type BlueprintDescriptors = { readonly [Type in BlueprintType]: BlueprintDescriptor<Type> };

function requireOnlineContext(context: BaseAudioContext, api: string): AudioContext {
  if (!("createMediaElementSource" in context)) {
    return AudioUnsupportedError.missingApi(`${api} on an offline context`);
  }

  // SAFETY: only `AudioContext` implements `createMediaElementSource`.
  return context as AudioContext;
}

/**
 * Reads an options object decoded from a preset.
 *
 * The preset schema guarantees JSON, and this checks that node options are an object. Field
 * values are validated where the node is built (the `native.ts` factories and Web Audio
 * constructors reject out-of-range values), so a hand-edited preset fails at playback with a
 * native error rather than silently.
 */
function presetOptions<Options>(hydration: BlueprintHydration): Options | undefined {
  const { options } = hydration;

  if (options !== undefined && options !== null && !isPlainObject(options)) {
    AudioGraphError.invalidPreset({ cause: `options of ${hydration.id} must be an object` });
  }

  // SAFETY: an options object stored for this node type by `serializeGraphPreset`.
  return (options ?? undefined) as Options | undefined;
}

function requirePresetOption<Value>(hydration: BlueprintHydration, key: string): Value {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Reads one named option from a decoded preset option bag before validating it.
  const options = presetOptions<Readonly<Record<string, unknown>>>(hydration);
  const value = options?.[key];

  if (value === undefined || value === null) {
    return AudioGraphError.missingNodeOption(hydration.id, key);
  }

  // SAFETY: resource values are decoded by the preset resource codec for this key.
  return value as Value;
}

/**
 * The hydrated part with `role`, when it is a blueprint of `type`.
 */
function partOfType<Type extends BlueprintType>(
  hydration: BlueprintHydration,
  role: string,
  type: Type,
): BlueprintOfType<Type> | undefined {
  const part = hydration.parts?.[role];

  if (part === undefined || Array.isArray(part)) {
    return undefined;
  }

  // SAFETY: `part` is a single blueprint (not a list) whose `type` is `Type`.
  return (part as Blueprint).type === type ? (part as BlueprintOfType<Type>) : undefined;
}

function hydrateCrossFade(hydration: BlueprintHydration): CrossFadeBlueprint {
  const a = partOfType(hydration, "a", "gain");
  const b = partOfType(hydration, "b", "gain");

  return new CrossFadeBlueprint(
    presetOptions(hydration),
    a === undefined || b === undefined ? undefined : { a, b },
  );
}

function hydratePlayer(hydration: BlueprintHydration): PlayerBlueprint {
  const source = partOfType(hydration, "source", "bufferSource");

  return new PlayerBlueprint(
    { volume: presetOptions<GainOptions>(hydration)?.gain },
    source === undefined ? undefined : { source },
  );
}

function hydrateGroup(hydration: BlueprintHydration): GroupBlueprint {
  const nodes = hydration.parts?.["nodes"];

  return group(Array.isArray(nodes) ? nodes : [], presetOptions(hydration));
}

function isSignalOperation(value: unknown): value is SignalOperation {
  return SIGNAL_OPERATIONS.some((operation) => operation === value);
}

function hydrateSignal(hydration: BlueprintHydration): SignalBlueprint {
  const options = presetOptions<{ readonly offset?: number }>(hydration);

  const metadata = presetOptions<{ readonly operation?: unknown; readonly sources?: unknown }>({
    ...hydration,
    options: hydration.metadata,
  });

  const operation = isSignalOperation(metadata?.operation) ? metadata.operation : "constant";

  const sources = Array.isArray(metadata?.sources)
    ? metadata.sources.filter((source): source is number => isNumber(source))
    : [];

  return new SignalBlueprint(operation, sources, { offset: options?.offset ?? 0 });
}

function createSignalNode(
  context: BaseAudioContext,
  blueprint: SignalBlueprint,
): ConstantSourceNode | GainNode | WaveShaperNode {
  const { options } = blueprint;

  if ("offset" in options) {
    return createConstantSourceNode(context, options);
  }

  if ("curve" in options) {
    return createWaveShaperNode(context, options);
  }

  return createGainNode(context, options);
}

function createNoiseNode(
  context: BaseAudioContext,
  blueprint: NoiseBlueprint,
): AudioBufferSourceNode {
  const { duration, length, numberOfChannels, sampleRate, seed, type, ...sourceOptions } =
    blueprint.options ?? {};

  const buffer = createNoiseBuffer(context, {
    duration,
    length,
    numberOfChannels,
    sampleRate,
    seed,
    type,
  });

  return createBufferSourceNode(context, {
    ...sourceOptions,
    buffer,
    loop: sourceOptions.loop ?? true,
  });
}

const BLUEPRINT_DESCRIPTORS: BlueprintDescriptors = {
  analyser: {
    createNode: (context, blueprint) => createAnalyserNode(context, blueprint.options),
    hydrate: (hydration) => analyser(presetOptions(hydration)),
  },
  biquadFilter: {
    createNode: (context, blueprint) => createBiquadFilterNode(context, blueprint.options),
    hydrate: (hydration) => biquadFilter(presetOptions(hydration)),
  },
  bufferSource: {
    createNode: (context, blueprint) => createBufferSourceNode(context, blueprint.options),
    hydrate: (hydration) => bufferSource(presetOptions(hydration)),
  },
  channelMerger: {
    createNode: (context, blueprint) => createChannelMergerNode(context, blueprint.options),
    hydrate: (hydration) => channelMerger(presetOptions(hydration)),
  },
  channelSplitter: {
    createNode: (context, blueprint) => createChannelSplitterNode(context, blueprint.options),
    hydrate: (hydration) => channelSplitter(presetOptions(hydration)),
  },
  compressor: {
    createNode: (context, blueprint) => createDynamicsCompressorNode(context, blueprint.options),
    hydrate: (hydration) => compressor(presetOptions(hydration)),
  },
  constantSource: {
    createNode: (context, blueprint) => createConstantSourceNode(context, blueprint.options),
    hydrate: (hydration) => constantSource(presetOptions(hydration)),
  },
  convolver: {
    createNode: (context, blueprint) => createConvolverNode(context, blueprint.options),
    hydrate: (hydration) => convolver(presetOptions(hydration)),
  },
  crossFade: {
    createNode: (context) => createGainNode(context, { gain: 1 }),
    hydrate: hydrateCrossFade,
  },
  delay: {
    createNode: (context, blueprint) => createDelayNode(context, blueprint.options),
    hydrate: (hydration) => delay(presetOptions(hydration)),
  },
  destination: {
    createNode: (context) => context.destination,
    hydrate: () => destination(),
  },
  gain: {
    createNode: (context, blueprint) => createGainNode(context, blueprint.options),
    hydrate: (hydration) => gain(presetOptions(hydration)),
  },
  group: {
    createNode: (context, blueprint) => createGainNode(context, blueprint.options),
    hydrate: hydrateGroup,
  },
  iirFilter: {
    createNode: (context, blueprint) => createIIRFilterNode(context, blueprint.options),
    hydrate: (hydration) => {
      const options = presetOptions<IIRFilterOptions>(hydration);

      if (options === undefined) {
        return AudioGraphError.missingNodeOption(hydration.id, "feedback");
      }

      return iirFilter(options);
    },
  },
  master: {
    createNode: (context, blueprint) => createGainNode(context, blueprint.options),
    hydrate: (hydration) => master(presetOptions(hydration)),
  },
  mediaElementSource: {
    createNode: (context, blueprint) =>
      createMediaElementSourceNode(
        requireOnlineContext(context, "MediaElementAudioSourceNode"),
        blueprint.options.mediaElement,
      ),
    hydrate: (hydration) =>
      mediaElementSource(requirePresetOption<HTMLMediaElement>(hydration, "mediaElement")),
  },
  mediaStreamDestination: {
    createNode: (context) =>
      createMediaStreamDestinationNode(
        requireOnlineContext(context, "MediaStreamAudioDestinationNode"),
      ),
    hydrate: () => mediaStreamDestination(),
  },
  mediaStreamSource: {
    createNode: (context, blueprint) =>
      createMediaStreamSourceNode(
        requireOnlineContext(context, "MediaStreamAudioSourceNode"),
        blueprint.options.mediaStream,
      ),
    hydrate: (hydration) =>
      mediaStreamSource(requirePresetOption<MediaStream>(hydration, "mediaStream")),
  },
  mediaStreamTrackSource: {
    createNode: (context, blueprint) =>
      createMediaStreamTrackSourceNode(
        requireOnlineContext(context, "MediaStreamTrackAudioSourceNode"),
        blueprint.options.mediaStreamTrack,
      ),
    hydrate: (hydration) =>
      mediaStreamTrackSource(requirePresetOption<MediaStreamTrack>(hydration, "mediaStreamTrack")),
  },
  noise: {
    createNode: createNoiseNode,
    hydrate: (hydration) => noise(presetOptions<NoiseBlueprintOptions>(hydration)),
  },
  oscillator: {
    createNode: (context, blueprint) => createOscillatorNode(context, blueprint.options),
    hydrate: (hydration) => oscillator(presetOptions(hydration)),
  },
  panner: {
    createNode: (context, blueprint) => createPannerNode(context, blueprint.options),
    hydrate: (hydration) => panner(presetOptions(hydration)),
  },
  player: {
    createNode: (context, blueprint) => createGainNode(context, blueprint.options),
    hydrate: hydratePlayer,
  },
  signal: {
    createNode: createSignalNode,
    hydrate: hydrateSignal,
  },
  stereoPanner: {
    createNode: (context, blueprint) => createStereoPannerNode(context, blueprint.options),
    hydrate: (hydration) => stereoPanner(presetOptions(hydration)),
  },
  waveShaper: {
    createNode: (context, blueprint) => createWaveShaperNode(context, blueprint.options),
    hydrate: (hydration) => waveShaper(presetOptions(hydration)),
  },
  workletNode: {
    createNode: (context, blueprint) => {
      const { processorName, ...options } = blueprint.options;

      return createAudioWorkletNode(context, processorName, options);
    },
    hydrate: (hydration) => {
      const { processorName, ...options } = requirePresetOption<{
        readonly processorName: string;
      }>({ ...hydration, options: { value: hydration.options } }, "value");

      return workletNode(processorName, options);
    },
  },
};

export const BLUEPRINT_TYPES: readonly BlueprintType[] =
  Object.keys(BLUEPRINT_DESCRIPTORS).filter(isBlueprintType);

export function isBlueprintType(type: string): type is BlueprintType {
  return Object.hasOwn(BLUEPRINT_DESCRIPTORS, type);
}

export function isKnownBlueprint(blueprint: Blueprint): blueprint is KnownBlueprint {
  return isBlueprintType(blueprint.type);
}

/**
 * Creates the native node for a blueprint.
 */
export function createBlueprintNode<Node extends KnownBlueprint>(
  context: BaseAudioContext,
  blueprint: Node,
): LiveNodeFor<Node> {
  const descriptor: ErasedBlueprintDescriptor = BLUEPRINT_DESCRIPTORS[blueprint.type];

  // SAFETY: the descriptor selected by `blueprint.type` creates `BlueprintNodeMap[Node["type"]]`.
  return descriptor.createNode(context, blueprint) as LiveNodeFor<Node>;
}

export function hydrateBlueprint(hydration: BlueprintHydration): KnownBlueprint {
  if (!isBlueprintType(hydration.type)) {
    return AudioGraphError.unknownBlueprintType(hydration.type);
  }

  const descriptor: ErasedBlueprintDescriptor = BLUEPRINT_DESCRIPTORS[hydration.type];

  return descriptor.hydrate(hydration);
}
