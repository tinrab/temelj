/* oxlint-disable anti-slop/no-shape-in-symbol-names -- `WaveShaper` is the Web Audio API name (`WaveShaperNode`, `BaseAudioContext.createWaveShaper()`). */
import { AudioRangeError, AudioUnsupportedError } from "./errors.ts";

// `MediaStreamTrackAudioSourceNode` exists in Firefox 158 but not Chromium 155, and lib.dom does not declare it.
declare global {
  interface BaseAudioContext {
    createMediaStreamTrackSource?(
      mediaStreamTrack: MediaStreamTrack,
    ): MediaStreamTrackAudioSourceNode;
  }

  interface MediaStreamTrackAudioSourceNode extends AudioNode {
    readonly mediaStreamTrack: MediaStreamTrack;
  }
}

/*
 * Single construction layer for native Web Audio nodes.
 *
 * Nodes are created with the `BaseAudioContext.createX()` factory methods, which every supported
 * browser implements, and all `AudioNodeOptions` (including channel configuration) are applied
 * afterwards so behaviour matches the `new XNode(context, options)` constructors.
 */

export type IIRFilterCoefficients = {
  readonly feedback: readonly number[];
  readonly feedforward: readonly number[];
};

export type ConvolverNodeOptions = ConvolverOptions & {
  readonly normalize?: boolean;
};

function setParam(param: AudioParam, value: number | undefined): void {
  if (value !== undefined) {
    param.value = value;
  }
}

function applyChannelOptions(node: AudioNode, options: AudioNodeOptions): void {
  if (options.channelCount !== undefined) {
    node.channelCount = options.channelCount;
  }

  if (options.channelCountMode !== undefined) {
    node.channelCountMode = options.channelCountMode;
  }

  if (options.channelInterpretation !== undefined) {
    node.channelInterpretation = options.channelInterpretation;
  }
}

export function createGainNode(context: BaseAudioContext, options: GainOptions = {}): GainNode {
  const node = context.createGain();
  applyChannelOptions(node, options);
  setParam(node.gain, options.gain);

  return node;
}

export function createOscillatorNode(
  context: BaseAudioContext,
  options: OscillatorOptions = {},
): OscillatorNode {
  const node = context.createOscillator();
  applyChannelOptions(node, options);
  setParam(node.frequency, options.frequency);
  setParam(node.detune, options.detune);

  if (options.periodicWave !== undefined) {
    node.setPeriodicWave(options.periodicWave);
  } else if (options.type !== undefined) {
    node.type = options.type;
  }

  return node;
}

export function createBufferSourceNode(
  context: BaseAudioContext,
  options: AudioBufferSourceOptions = {},
): AudioBufferSourceNode {
  const node = context.createBufferSource();

  if (options.buffer !== undefined) {
    node.buffer = options.buffer;
  }

  if (options.loop !== undefined) {
    node.loop = options.loop;
  }

  if (options.loopStart !== undefined) {
    node.loopStart = options.loopStart;
  }

  if (options.loopEnd !== undefined) {
    node.loopEnd = options.loopEnd;
  }

  setParam(node.detune, options.detune);
  setParam(node.playbackRate, options.playbackRate);

  return node;
}

export function createConstantSourceNode(
  context: BaseAudioContext,
  options: ConstantSourceOptions = {},
): ConstantSourceNode {
  const node = context.createConstantSource();
  setParam(node.offset, options.offset);

  return node;
}

export function createBiquadFilterNode(
  context: BaseAudioContext,
  options: BiquadFilterOptions = {},
): BiquadFilterNode {
  const node = context.createBiquadFilter();
  applyChannelOptions(node, options);

  if (options.type !== undefined) {
    node.type = options.type;
  }

  setParam(node.frequency, options.frequency);
  setParam(node.detune, options.detune);
  setParam(node.Q, options.Q);
  setParam(node.gain, options.gain);

  return node;
}

export function createDelayNode(context: BaseAudioContext, options: DelayOptions = {}): DelayNode {
  const node = context.createDelay(options.maxDelayTime);
  applyChannelOptions(node, options);
  setParam(node.delayTime, options.delayTime);

  return node;
}

export function createDynamicsCompressorNode(
  context: BaseAudioContext,
  options: DynamicsCompressorOptions = {},
): DynamicsCompressorNode {
  const node = context.createDynamicsCompressor();
  applyChannelOptions(node, options);
  setParam(node.attack, options.attack);
  setParam(node.knee, options.knee);
  setParam(node.ratio, options.ratio);
  setParam(node.release, options.release);
  setParam(node.threshold, options.threshold);

  return node;
}

export function createPannerNode(
  context: BaseAudioContext,
  options: PannerOptions = {},
): PannerNode {
  const node = context.createPanner();
  applyChannelOptions(node, options);

  if (options.panningModel !== undefined) {
    node.panningModel = options.panningModel;
  }

  if (options.distanceModel !== undefined) {
    node.distanceModel = options.distanceModel;
  }

  if (options.refDistance !== undefined) {
    node.refDistance = options.refDistance;
  }

  if (options.maxDistance !== undefined) {
    node.maxDistance = options.maxDistance;
  }

  if (options.rolloffFactor !== undefined) {
    node.rolloffFactor = options.rolloffFactor;
  }

  if (options.coneInnerAngle !== undefined) {
    node.coneInnerAngle = options.coneInnerAngle;
  }

  if (options.coneOuterAngle !== undefined) {
    node.coneOuterAngle = options.coneOuterAngle;
  }

  if (options.coneOuterGain !== undefined) {
    node.coneOuterGain = options.coneOuterGain;
  }

  setParam(node.positionX, options.positionX);
  setParam(node.positionY, options.positionY);
  setParam(node.positionZ, options.positionZ);
  setParam(node.orientationX, options.orientationX);
  setParam(node.orientationY, options.orientationY);
  setParam(node.orientationZ, options.orientationZ);

  return node;
}

export function createStereoPannerNode(
  context: BaseAudioContext,
  options: StereoPannerOptions = {},
): StereoPannerNode {
  const node = context.createStereoPanner();
  applyChannelOptions(node, options);
  setParam(node.pan, options.pan);

  return node;
}

export function createWaveShaperNode(
  context: BaseAudioContext,
  options: WaveShaperOptions = {},
): WaveShaperNode {
  const node = context.createWaveShaper();
  applyChannelOptions(node, options);

  if (options.curve !== undefined) {
    node.curve = Float32Array.from(options.curve);
  }

  if (options.oversample !== undefined) {
    node.oversample = requireOverSampleType(options.oversample);
  }

  return node;
}

export function requireOverSampleType(oversample: OverSampleType): OverSampleType {
  if (oversample !== "none" && oversample !== "2x" && oversample !== "4x") {
    AudioRangeError.invalidOption("oversample", oversample);
  }

  return oversample;
}

export function createIIRFilterNode(
  context: BaseAudioContext,
  coefficients: IIRFilterCoefficients,
): IIRFilterNode {
  return context.createIIRFilter([...coefficients.feedforward], [...coefficients.feedback]);
}

export function createConvolverNode(
  context: BaseAudioContext,
  options: ConvolverNodeOptions = {},
): ConvolverNode {
  const node = context.createConvolver();
  applyChannelOptions(node, options);
  node.normalize = options.normalize ?? !(options.disableNormalization ?? false);

  if (options.buffer !== undefined) {
    node.buffer = options.buffer;
  }

  return node;
}

export function createAnalyserNode(
  context: BaseAudioContext,
  options: AnalyserOptions = {},
): AnalyserNode {
  const node = context.createAnalyser();
  applyChannelOptions(node, options);

  if (options.fftSize !== undefined) {
    node.fftSize = options.fftSize;
  }

  if (options.minDecibels !== undefined) {
    node.minDecibels = options.minDecibels;
  }

  if (options.maxDecibels !== undefined) {
    node.maxDecibels = options.maxDecibels;
  }

  if (options.smoothingTimeConstant !== undefined) {
    node.smoothingTimeConstant = options.smoothingTimeConstant;
  }

  return node;
}

export function createChannelMergerNode(
  context: BaseAudioContext,
  options: ChannelMergerOptions = {},
): ChannelMergerNode {
  return context.createChannelMerger(options.numberOfInputs);
}

export function createChannelSplitterNode(
  context: BaseAudioContext,
  options: ChannelSplitterOptions = {},
): ChannelSplitterNode {
  return context.createChannelSplitter(options.numberOfOutputs);
}

/**
 * Source node already created for each media element. Web Audio lets an element feed only one
 * `MediaElementAudioSourceNode`, so playing it again must reuse that node.
 */
const mediaElementSourceNodes = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

/**
 * Returns the `MediaElementAudioSourceNode` for `mediaElement` on `context`, creating it the first
 * time. Only realtime contexts can create one, and an element stays bound to the context that
 * first used it.
 *
 * @throws {AudioUnsupportedError} When `context` cannot create media element sources.
 */
export function createMediaElementSourceNode(
  context: BaseAudioContext,
  mediaElement: HTMLMediaElement,
): MediaElementAudioSourceNode {
  if (!("createMediaElementSource" in context)) {
    return AudioUnsupportedError.missingApi("MediaElementAudioSourceNode");
  }

  const existing = mediaElementSourceNodes.get(mediaElement);

  if (existing !== undefined && existing.context === context) {
    return existing;
  }

  // SAFETY: only `AudioContext` has `createMediaElementSource`.
  const node = (context as AudioContext).createMediaElementSource(mediaElement);
  mediaElementSourceNodes.set(mediaElement, node);

  return node;
}

export function createMediaStreamSourceNode(
  context: AudioContext,
  mediaStream: MediaStream,
): MediaStreamAudioSourceNode {
  return context.createMediaStreamSource(mediaStream);
}

export function createMediaStreamTrackSourceNode(
  context: AudioContext,
  mediaStreamTrack: MediaStreamTrack,
): MediaStreamTrackAudioSourceNode {
  if (context.createMediaStreamTrackSource === undefined) {
    AudioUnsupportedError.missingApi("MediaStreamTrackAudioSourceNode");
  }

  return context.createMediaStreamTrackSource(mediaStreamTrack);
}

/**
 * Creates a `MediaStreamAudioDestinationNode`, which only realtime contexts can create.
 *
 * @throws {AudioUnsupportedError} When `context` cannot create media stream destinations.
 */
export function createMediaStreamDestinationNode(
  context: BaseAudioContext,
): MediaStreamAudioDestinationNode {
  if (!("createMediaStreamDestination" in context)) {
    return AudioUnsupportedError.missingApi("MediaStreamAudioDestinationNode");
  }

  // SAFETY: only `AudioContext` has `createMediaStreamDestination`.
  return (context as AudioContext).createMediaStreamDestination();
}

export function createAudioWorkletNode(
  context: BaseAudioContext,
  processorName: string,
  options: AudioWorkletNodeOptions = {},
): AudioWorkletNode {
  if (globalThis.AudioWorkletNode === undefined) {
    AudioUnsupportedError.missingApi("AudioWorkletNode");
  }

  return new AudioWorkletNode(context, processorName, options);
}

/**
 * Stops a scheduled source and ignores any error from `stop()`, such as the `InvalidStateError` for
 * a source that was never started. Used on teardown paths, where the source may not be running.
 */
export function stopQuietly(source: AudioScheduledSourceNode, time?: number): void {
  try {
    source.stop(time);
  } catch {
    // `stop()` throws when the source never started; there is nothing to stop then.
  }
}

export function connectSeries(first: AudioNode, ...rest: readonly AudioNode[]): void {
  let previous = first;

  for (const node of rest) {
    previous.connect(node);
    previous = node;
  }
}

export function disconnectAll(nodes: Iterable<AudioNode>): void {
  for (const node of nodes) {
    node.disconnect();
  }
}

/**
 * Connects a node to another node or to an `AudioParam` and returns the destination.
 */
export function connectTo<TDestination extends AudioNode | AudioParam>(
  source: AudioNode,
  destination: TDestination,
): TDestination {
  if ("connect" in destination) {
    source.connect(destination);
  } else {
    source.connect(destination);
  }

  return destination;
}

/**
 * Tracks the native nodes a runtime unit creates so `dispose()` can release all of them.
 */
export class OwnedNodes {
  readonly #nodes: AudioNode[] = [];
  readonly #sources = new Set<AudioScheduledSourceNode>();

  add<Node extends AudioNode>(node: Node): Node {
    this.#nodes.push(node);

    return node;
  }

  /**
   * Tracks a scheduled source so `dispose()` also stops it, ignoring sources that cannot be
   * stopped.
   */
  addSource<Node extends AudioScheduledSourceNode>(node: Node): Node {
    this.#sources.add(node);

    return this.add(node);
  }

  dispose(time?: number): void {
    for (const source of this.#sources) {
      stopQuietly(source, time);
    }

    disconnectAll(this.#nodes);
    this.#sources.clear();
    this.#nodes.length = 0;
  }
}
