/* oxlint-disable anti-slop/no-shape-in-symbol-names -- `WaveShaper` is the Web Audio API name (`WaveShaperNode`, `BaseAudioContext.createWaveShaper()`). */
import type { NoiseType } from "../source/noise.ts";

import { AudioGraphError, AudioRangeError } from "../errors.ts";
import { clampNormal, requireFinite } from "../validation.ts";

/**
 * Names of the `AudioParam`s exposed by each native-backed blueprint type.
 */
type ParamKeyTable = {
  readonly biquadFilter: readonly ["frequency", "detune", "Q", "gain"];
  readonly bufferSource: readonly ["playbackRate", "detune"];
  readonly compressor: readonly ["threshold", "knee", "ratio", "attack", "release"];
  readonly constantSource: readonly ["offset"];
  readonly delay: readonly ["delayTime"];
  readonly gain: readonly ["gain"];
  readonly noise: readonly ["playbackRate", "detune"];
  readonly oscillator: readonly ["frequency", "detune"];
  readonly panner: readonly [
    "orientationX",
    "orientationY",
    "orientationZ",
    "positionX",
    "positionY",
    "positionZ",
  ];
  readonly stereoPanner: readonly ["pan"];
};

export const BLUEPRINT_PARAM_KEYS: ParamKeyTable = {
  biquadFilter: ["frequency", "detune", "Q", "gain"],
  bufferSource: ["playbackRate", "detune"],
  compressor: ["threshold", "knee", "ratio", "attack", "release"],
  constantSource: ["offset"],
  delay: ["delayTime"],
  gain: ["gain"],
  noise: ["playbackRate", "detune"],
  oscillator: ["frequency", "detune"],
  panner: ["orientationX", "orientationY", "orientationZ", "positionX", "positionY", "positionZ"],
  stereoPanner: ["pan"],
};

export type BlueprintParamsOf<Type extends keyof ParamKeyTable> = Readonly<
  Record<ParamKeyTable[Type][number], BlueprintParam>
>;

export type BlueprintParams = Readonly<Record<string, BlueprintParam | undefined>>;

export type EmptyBlueprintParams = Readonly<Record<never, BlueprintParam>>;

/**
 * Reference to an `AudioParam` on a blueprint. Connecting a blueprint to a param modulates it.
 */
export class BlueprintParam {
  readonly owner: Blueprint;
  readonly key: string;

  constructor(owner: Blueprint, key: string) {
    this.owner = owner;
    this.key = key;
  }
}

export type Connectable = Blueprint | BlueprintParam;

export type BlueprintConnection = {
  readonly source: Blueprint;
  readonly destination: Connectable;
  readonly output?: number;
  readonly input?: number;
};

export function getConnectableOwner(destination: Connectable): Blueprint {
  return destination instanceof BlueprintParam ? destination.owner : destination;
}

function createParams<Params extends BlueprintParams>(
  owner: Blueprint,
  keys: readonly string[],
): Params {
  const params: Record<string, BlueprintParam> = {};

  for (const key of keys) {
    params[key] = new BlueprintParam(owner, key);
  }

  // SAFETY: `keys` is the param key list that defines `Params` for this blueprint type.
  return params as Params;
}

/**
 * Description of one audio node that creates nothing by itself. Blueprints record their connections
 * in both directions, so a patch can walk upstream from a destination without any global registry.
 * `patch()` materializes them into native nodes.
 */
export class Blueprint<
  Type extends string = string,
  Options = unknown,
  Params extends BlueprintParams = BlueprintParams,
> {
  readonly id: symbol;
  readonly type: Type;
  readonly options: Options;
  readonly params: Params;
  readonly #outgoing: BlueprintConnection[] = [];
  readonly #incoming: BlueprintConnection[] = [];

  constructor(type: Type, options: Options, paramKeys: readonly string[] = []) {
    this.id = Symbol(type);
    this.type = type;
    this.options = options;
    this.params = createParams<Params>(this, paramKeys);
  }

  /**
   * Node that incoming connections attach to. Composite blueprints whose signal enters a
   * different node than the one they output from override this.
   */
  get input(): Blueprint {
    return this;
  }

  /**
   * Destinations of outgoing connections, in connection order.
   */
  get connections(): readonly Connectable[] {
    return this.#outgoing.map((connection) => connection.destination);
  }

  get outgoing(): readonly BlueprintConnection[] {
    return [...this.#outgoing];
  }

  get incoming(): readonly BlueprintConnection[] {
    return [...this.#incoming];
  }

  /**
   * Internal blueprints a composite owns, by role. Graph snapshots record them so a hydrated
   * composite adopts the hydrated parts instead of building new ones.
   */
  get parts(): BlueprintParts | undefined {
    return undefined;
  }

  connect<Destination extends Connectable>(
    destination: Destination,
    output?: number,
    input?: number,
  ): Destination {
    Blueprint.#link(
      this,
      destination instanceof Blueprint ? destination.input : destination,
      output,
      input,
    );

    return destination;
  }

  /**
   * Connects `source` to this blueprint itself, bypassing `input`. Composite blueprints use it
   * to wire their internal stages into their output.
   */
  protected connectFrom(source: Blueprint, output?: number, input?: number): void {
    Blueprint.#link(source, this, output, input);
  }

  /**
   * Removes every connection to `destination`, or all outgoing connections when omitted.
   */
  disconnect(destination?: Connectable): void {
    for (const connection of Array.from(this.#outgoing)) {
      if (
        destination === undefined ||
        connection.destination === destination ||
        (destination instanceof Blueprint && connection.destination === destination.input)
      ) {
        Blueprint.#unlink(connection);
      }
    }
  }

  /**
   * Removes every incoming and outgoing connection of this blueprint.
   */
  dispose(): void {
    for (const connection of [...this.#outgoing, ...this.#incoming]) {
      Blueprint.#unlink(connection);
    }
  }

  /**
   * Records a connection. Like `AudioNode.connect()`, connecting the same pair again is a no-op.
   */
  static #link(
    source: Blueprint,
    destination: Connectable,
    output: number | undefined,
    input: number | undefined,
  ): void {
    const exists = source.#outgoing.some(
      (connection) =>
        connection.destination === destination &&
        connection.output === output &&
        connection.input === input,
    );

    if (exists) {
      return;
    }

    const connection: BlueprintConnection = { source, destination, output, input };
    source.#outgoing.push(connection);
    getConnectableOwner(destination).#incoming.push(connection);
  }

  static #unlink(connection: BlueprintConnection): void {
    const outgoing = connection.source.#outgoing;
    const incoming = getConnectableOwner(connection.destination).#incoming;
    outgoing.splice(outgoing.indexOf(connection), 1);
    incoming.splice(incoming.indexOf(connection), 1);
  }
}

/**
 * Internal blueprints of a composite, by role.
 */
export type BlueprintParts = Readonly<Record<string, Blueprint | readonly Blueprint[]>>;

export type PlayerBlueprintParts = { readonly source: BufferSourceBlueprint };

export type CrossFadeBlueprintParts = { readonly a: GainBlueprint; readonly b: GainBlueprint };

export type GroupBlueprintParts = { readonly nodes: readonly Blueprint[] };

export type IIRFilterOptions = {
  readonly feedback: readonly number[];
  readonly feedforward: readonly number[];
};

export type WorkletNodeOptions = AudioWorkletNodeOptions & {
  readonly processorName: string;
};

export type NoiseBlueprintOptions = Omit<AudioBufferSourceOptions, "buffer"> & {
  readonly duration?: number;
  readonly length?: number;
  readonly numberOfChannels?: number;
  readonly sampleRate?: number;
  readonly seed?: number;
  readonly type?: NoiseType;
};

export type AnalyserBlueprint = Blueprint<
  "analyser",
  AnalyserOptions | undefined,
  EmptyBlueprintParams
>;

export type BiquadFilterBlueprint = Blueprint<
  "biquadFilter",
  BiquadFilterOptions | undefined,
  BlueprintParamsOf<"biquadFilter">
>;

export type BufferSourceBlueprint = Blueprint<
  "bufferSource",
  AudioBufferSourceOptions | undefined,
  BlueprintParamsOf<"bufferSource">
>;

export type ChannelMergerBlueprint = Blueprint<
  "channelMerger",
  ChannelMergerOptions | undefined,
  EmptyBlueprintParams
>;

export type ChannelSplitterBlueprint = Blueprint<
  "channelSplitter",
  ChannelSplitterOptions | undefined,
  EmptyBlueprintParams
>;

export type CompressorBlueprint = Blueprint<
  "compressor",
  DynamicsCompressorOptions | undefined,
  BlueprintParamsOf<"compressor">
>;

export type ConstantSourceBlueprint = Blueprint<
  "constantSource",
  ConstantSourceOptions | undefined,
  BlueprintParamsOf<"constantSource">
>;

export type ConvolverBlueprint = Blueprint<
  "convolver",
  ConvolverOptions | undefined,
  EmptyBlueprintParams
>;

export type DelayBlueprint = Blueprint<
  "delay",
  DelayOptions | undefined,
  BlueprintParamsOf<"delay">
>;

export type DestinationBlueprint = Blueprint<"destination", undefined, EmptyBlueprintParams>;

export type GainBlueprint = Blueprint<"gain", GainOptions | undefined, BlueprintParamsOf<"gain">>;

export type IIRFilterBlueprint = Blueprint<"iirFilter", IIRFilterOptions, EmptyBlueprintParams>;

export type MediaElementSourceBlueprint = Blueprint<
  "mediaElementSource",
  { readonly mediaElement: HTMLMediaElement },
  EmptyBlueprintParams
>;

export type MediaStreamDestinationBlueprint = Blueprint<
  "mediaStreamDestination",
  undefined,
  EmptyBlueprintParams
>;

export type MediaStreamSourceBlueprint = Blueprint<
  "mediaStreamSource",
  { readonly mediaStream: MediaStream },
  EmptyBlueprintParams
>;

export type MediaStreamTrackSourceBlueprint = Blueprint<
  "mediaStreamTrackSource",
  { readonly mediaStreamTrack: MediaStreamTrack },
  EmptyBlueprintParams
>;

export type NoiseBlueprint = Blueprint<
  "noise",
  NoiseBlueprintOptions | undefined,
  BlueprintParamsOf<"noise">
>;

export type OscillatorBlueprint = Blueprint<
  "oscillator",
  OscillatorOptions | undefined,
  BlueprintParamsOf<"oscillator">
>;

export type PannerBlueprint = Blueprint<
  "panner",
  PannerOptions | undefined,
  BlueprintParamsOf<"panner">
>;

export type StereoPannerBlueprint = Blueprint<
  "stereoPanner",
  StereoPannerOptions | undefined,
  BlueprintParamsOf<"stereoPanner">
>;

export type WaveShaperBlueprint = Blueprint<
  "waveShaper",
  WaveShaperOptions | undefined,
  EmptyBlueprintParams
>;

export type WorkletNodeBlueprint = Blueprint<
  "workletNode",
  WorkletNodeOptions,
  EmptyBlueprintParams
>;

function createNode<Node extends Blueprint>(
  type: Node["type"],
  options: Node["options"],
  paramKeys: readonly string[] = [],
): Node {
  // SAFETY: `Node` is one of the aliases above. They are plain `Blueprint` instantiations whose
  // params are created from `paramKeys`.
  return new Blueprint(type, options, paramKeys) as Node;
}

/**
 * Creates an `OscillatorNode` blueprint. Start it from a play callback with `start()`.
 */
export function oscillator(options?: OscillatorOptions): OscillatorBlueprint {
  return createNode<OscillatorBlueprint>("oscillator", options, BLUEPRINT_PARAM_KEYS.oscillator);
}

/**
 * Creates a `GainNode` blueprint.
 */
export function gain(options?: GainOptions): GainBlueprint {
  return createNode<GainBlueprint>("gain", options, BLUEPRINT_PARAM_KEYS.gain);
}

/**
 * Creates an `AudioBufferSourceNode` blueprint. Start it from a play callback with `start()`.
 */
export function bufferSource(options?: AudioBufferSourceOptions): BufferSourceBlueprint {
  return createNode<BufferSourceBlueprint>(
    "bufferSource",
    options,
    BLUEPRINT_PARAM_KEYS.bufferSource,
  );
}

/**
 * Creates a noise source blueprint of the given color (`white` by default). It loops unless `loop`
 * is `false`.
 */
export function noise(options?: NoiseBlueprintOptions): NoiseBlueprint {
  return createNode<NoiseBlueprint>("noise", options, BLUEPRINT_PARAM_KEYS.noise);
}

/**
 * Creates a `ConstantSourceNode` blueprint. It starts automatically when the patch plays.
 */
export function constantSource(options?: ConstantSourceOptions): ConstantSourceBlueprint {
  return createNode<ConstantSourceBlueprint>(
    "constantSource",
    options,
    BLUEPRINT_PARAM_KEYS.constantSource,
  );
}

/**
 * Creates an `AnalyserNode` blueprint. Read it during playback with `get()` on the play context.
 */
export function analyser(options?: AnalyserOptions): AnalyserBlueprint {
  return createNode<AnalyserBlueprint>("analyser", options);
}

/**
 * Creates a `DelayNode` blueprint.
 */
export function delay(options?: DelayOptions): DelayBlueprint {
  return createNode<DelayBlueprint>("delay", options, BLUEPRINT_PARAM_KEYS.delay);
}

/**
 * Creates a `ConvolverNode` blueprint.
 */
export function convolver(options?: ConvolverOptions): ConvolverBlueprint {
  return createNode<ConvolverBlueprint>("convolver", options);
}

/**
 * Creates a `DynamicsCompressorNode` blueprint.
 */
export function compressor(options?: DynamicsCompressorOptions): CompressorBlueprint {
  return createNode<CompressorBlueprint>("compressor", options, BLUEPRINT_PARAM_KEYS.compressor);
}

/**
 * Creates a 3D `PannerNode` blueprint.
 */
export function panner(options?: PannerOptions): PannerBlueprint {
  return createNode<PannerBlueprint>("panner", options, BLUEPRINT_PARAM_KEYS.panner);
}

/**
 * Creates a `StereoPannerNode` blueprint.
 */
export function stereoPanner(options?: StereoPannerOptions): StereoPannerBlueprint {
  return createNode<StereoPannerBlueprint>(
    "stereoPanner",
    options,
    BLUEPRINT_PARAM_KEYS.stereoPanner,
  );
}

/**
 * Creates a `WaveShaperNode` blueprint.
 */
export function waveShaper(options?: WaveShaperOptions): WaveShaperBlueprint {
  return createNode<WaveShaperBlueprint>("waveShaper", options);
}

/**
 * Creates a `BiquadFilterNode` blueprint.
 */
export function biquadFilter(options?: BiquadFilterOptions): BiquadFilterBlueprint {
  return createNode<BiquadFilterBlueprint>(
    "biquadFilter",
    options,
    BLUEPRINT_PARAM_KEYS.biquadFilter,
  );
}

function requireCoefficients(
  coefficients: readonly number[],
  name: "feedback" | "feedforward",
): readonly number[] {
  if (coefficients.length === 0) {
    AudioRangeError.invalidOption(`IIR filter ${name}`, "[]");
  }

  return coefficients.map((value, index) => requireFinite(value, `IIR filter ${name}[${index}]`));
}

/**
 * Creates an `IIRFilterNode` blueprint from feedforward and feedback coefficients.
 *
 * @throws {AudioRangeError} When either coefficient list is empty or not finite, or `feedback[0]`
 * is 0.
 */
export function iirFilter(options: IIRFilterOptions): IIRFilterBlueprint {
  const feedforward = requireCoefficients(options.feedforward, "feedforward");
  const feedback = requireCoefficients(options.feedback, "feedback");

  if (feedback[0] === 0) {
    AudioRangeError.invalidOption("IIR filter feedback[0]", 0);
  }

  return createNode<IIRFilterBlueprint>("iirFilter", { feedback, feedforward });
}

/**
 * Creates a `ChannelMergerNode` blueprint.
 */
export function channelMerger(options?: ChannelMergerOptions): ChannelMergerBlueprint {
  return createNode<ChannelMergerBlueprint>("channelMerger", options);
}

/**
 * Creates a `ChannelSplitterNode` blueprint.
 */
export function channelSplitter(options?: ChannelSplitterOptions): ChannelSplitterBlueprint {
  return createNode<ChannelSplitterBlueprint>("channelSplitter", options);
}

/**
 * Creates a blueprint that plays `mediaElement` through the graph. Web Audio binds an element to
 * one source node, so every playback reuses it and the element stays tied to the first context that
 * played it.
 */
export function mediaElementSource(mediaElement: HTMLMediaElement): MediaElementSourceBlueprint {
  return createNode<MediaElementSourceBlueprint>("mediaElementSource", { mediaElement });
}

/**
 * Creates a blueprint that plays `mediaStream`, such as microphone input, through the graph.
 */
export function mediaStreamSource(mediaStream: MediaStream): MediaStreamSourceBlueprint {
  return createNode<MediaStreamSourceBlueprint>("mediaStreamSource", { mediaStream });
}

/**
 * Creates a blueprint that plays one `MediaStreamTrack` through the graph. Firefox 158 implements
 * this node and Chromium 155 does not; check
 * `getAudioContextCapabilities(context).mediaStreamTrackSource` before using it.
 */
export function mediaStreamTrackSource(
  mediaStreamTrack: MediaStreamTrack,
): MediaStreamTrackSourceBlueprint {
  return createNode<MediaStreamTrackSourceBlueprint>("mediaStreamTrackSource", {
    mediaStreamTrack,
  });
}

/**
 * Creates a blueprint whose output is a `MediaStream`, for recording or WebRTC.
 */
export function mediaStreamDestination(): MediaStreamDestinationBlueprint {
  return createNode<MediaStreamDestinationBlueprint>("mediaStreamDestination", undefined);
}

/**
 * Creates an `AudioWorkletNode` blueprint for a registered processor. Register the module before
 * playing the patch.
 */
export function workletNode(
  processorName: string,
  options: AudioWorkletNodeOptions = {},
): WorkletNodeBlueprint {
  return createNode<WorkletNodeBlueprint>("workletNode", { ...options, processorName });
}

/**
 * Creates the output of a graph. Each graph gets its own destination, and `patch()` plays
 * everything connected upstream of it.
 */
export function destination(): DestinationBlueprint {
  return createNode<DestinationBlueprint>("destination", undefined);
}

export type PlayerBlueprintOptions = {
  readonly buffer?: AudioBuffer;
  readonly loop?: boolean;
  readonly volume?: number;
};

/**
 * Buffer playback with its own output gain. Materialized as a gain node fed by `source`.
 */
export class PlayerBlueprint extends Blueprint<
  "player",
  GainOptions | undefined,
  BlueprintParamsOf<"gain">
> {
  readonly source: BufferSourceBlueprint;

  /**
   * `parts.source` adopts an existing buffer source instead of creating one.
   */
  constructor(options: PlayerBlueprintOptions = {}, parts?: PlayerBlueprintParts) {
    super(
      "player",
      options.volume === undefined ? undefined : { gain: options.volume },
      BLUEPRINT_PARAM_KEYS.gain,
    );
    this.source =
      parts?.source ??
      bufferSource(
        options.buffer === undefined ? undefined : { buffer: options.buffer, loop: options.loop },
      );
    this.source.connect(this);
  }

  override get parts(): PlayerBlueprintParts {
    return { source: this.source };
  }
}

/**
 * Creates a buffer player blueprint: a buffer source (looping when `loop` is set) behind a gain set
 * to `volume`.
 */
export function player(options: PlayerBlueprintOptions = {}): PlayerBlueprint {
  return new PlayerBlueprint(options);
}

export type MasterOptions = GainOptions & {
  readonly muted?: boolean;
  readonly volume?: number;
};

export type MasterBlueprint = Blueprint<"master", GainOptions, BlueprintParamsOf<"gain">>;

/**
 * Creates a master output blueprint: a gain set to `volume`, or silent when `muted` is set.
 */
export function master(options: MasterOptions = {}): MasterBlueprint {
  const { muted = false, volume, ...gainOptions } = options;

  return createNode<MasterBlueprint>(
    "master",
    { ...gainOptions, gain: muted ? 0 : (volume ?? gainOptions.gain ?? 1) },
    BLUEPRINT_PARAM_KEYS.gain,
  );
}

export type CrossFadeOptions = {
  readonly fade?: number;
};

/**
 * Linear crossfade between inputs `a` and `b`, materialized as a gain node that sums them. `a` is
 * scaled by `1 - fade` and `b` by `fade`.
 */
export class CrossFadeBlueprint extends Blueprint<
  "crossFade",
  CrossFadeOptions,
  BlueprintParamsOf<"gain">
> {
  readonly a: GainBlueprint;
  readonly b: GainBlueprint;
  readonly fade: number;

  /**
   * `parts` adopts existing input gains instead of creating them.
   */
  constructor(options: CrossFadeOptions = {}, parts?: CrossFadeBlueprintParts) {
    const fade = clampNormal(options.fade ?? 0.5, "fade");
    super("crossFade", { fade }, BLUEPRINT_PARAM_KEYS.gain);
    this.fade = fade;
    this.a = parts?.a ?? gain({ gain: 1 - fade });
    this.b = parts?.b ?? gain({ gain: fade });
    this.a.connect(this);
    this.b.connect(this);
  }

  override get parts(): CrossFadeBlueprintParts {
    return { a: this.a, b: this.b };
  }
}

/**
 * Creates a blueprint that blends inputs `a` and `b` with linear gains. A `fade` of 0 plays only
 * `a` and 1 plays only `b`; the default is 0.5.
 */
export function crossFade(options: CrossFadeOptions = {}): CrossFadeBlueprint {
  return new CrossFadeBlueprint(options);
}

/**
 * Sums its `nodes` into one gain-controlled output.
 */
export class GroupBlueprint extends Blueprint<
  "group",
  GainOptions | undefined,
  BlueprintParamsOf<"gain">
> {
  readonly nodes: readonly Blueprint[];

  constructor(nodes: readonly Blueprint[], options?: GainOptions) {
    super("group", options, BLUEPRINT_PARAM_KEYS.gain);
    this.nodes = [...nodes];

    for (const node of this.nodes) {
      node.connect(this);
    }
  }

  override get parts(): GroupBlueprintParts {
    return { nodes: this.nodes };
  }
}

/**
 * Creates a blueprint that sums `nodes` into one gain-controlled output.
 */
export function group(nodes: readonly Blueprint[] = [], options?: GainOptions): GroupBlueprint {
  return new GroupBlueprint(nodes, options);
}

type LastOf<Nodes extends readonly Blueprint[]> = Nodes extends readonly [
  ...Blueprint[],
  infer Last,
]
  ? Last
  : Blueprint;

/**
 * Connects each node to the next and returns the last one.
 */
export function chain<const Nodes extends readonly [Blueprint, ...Blueprint[]]>(
  ...nodes: Nodes
): LastOf<Nodes> {
  const [first, ...rest] = nodes;

  if (first === undefined) {
    return AudioGraphError.emptyChain();
  }

  let previous: Blueprint = first;

  for (const node of rest) {
    previous = previous.connect(node);
  }

  // SAFETY: `previous` is the last element of `nodes`, which is what `LastOf` names.
  return previous as LastOf<Nodes>;
}

/**
 * Connects `source` to every target and returns `source`.
 */
export function fan<Source extends Blueprint>(
  source: Source,
  ...targets: readonly Connectable[]
): Source {
  for (const target of targets) {
    source.connect(target);
  }

  return source;
}
