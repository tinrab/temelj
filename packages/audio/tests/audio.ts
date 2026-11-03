/* oxlint-disable anti-slop/no-shape-in-symbol-names -- `WaveShaper` is the Web Audio API name (`WaveShaperNode`, `BaseAudioContext.createWaveShaper()`). */
import { vi, type Mock } from "vitest";

import { AudioContextFacade, OnlineAudioContextFacade } from "../src/context/facade.ts";

type Connect = (destination: AudioNode | AudioParam, output?: number, input?: number) => AudioNode;

type Disconnect = (destination?: AudioNode | AudioParam, output?: number, input?: number) => void;

type ParamMethod<Args extends unknown[]> = Mock<(...args: Args) => AudioParam>;

/**
 * Casts a structural test double to the Web Audio type it stands in for.
 */
// oxlint-disable-next-line anti-slop/no-object-parameters -- Test-double cast helper; the single place structural mocks become native types.
export function asNative<Native>(mock: object): Native {
  // SAFETY: test doubles implement the members the code under test uses.
  return mock as Native;
}

/**
 * Views a node or param created through a mock context as its test double.
 */
export function asMock<Mock>(native: unknown): Mock {
  // SAFETY: mock contexts only ever create test doubles.
  return native as Mock;
}

type MockAudioWorklet = { readonly addModule: Mock<(url: string) => Promise<void>> };

/**
 * Passes a deliberately invalid value where the API types forbid it, to test runtime validation.
 */
export function invalid<Expected>(value: unknown): Expected {
  // SAFETY: the code under test is expected to reject this value at runtime.
  return value as Expected;
}

export class MockAudioParam {
  value: number;
  readonly cancelAndHoldAtTime: ParamMethod<[cancelTime: number]>;
  readonly cancelScheduledValues: ParamMethod<[cancelTime: number]>;
  readonly exponentialRampToValueAtTime: ParamMethod<[value: number, endTime: number]>;
  readonly linearRampToValueAtTime: ParamMethod<[value: number, endTime: number]>;
  readonly setTargetAtTime: ParamMethod<[target: number, startTime: number, timeConstant: number]>;
  readonly setValueAtTime: ParamMethod<[value: number, startTime: number]>;
  readonly setValueCurveAtTime: ParamMethod<
    [values: Float32Array, startTime: number, duration: number]
  >;

  constructor(value = 1) {
    this.value = value;
    const self = (): AudioParam => asNative<AudioParam>(this);

    const assign = (next: number): AudioParam => {
      this.value = next;

      return self();
    };

    this.cancelAndHoldAtTime = vi.fn<(cancelTime: number) => AudioParam>(self);
    this.cancelScheduledValues = vi.fn<(cancelTime: number) => AudioParam>(self);
    this.exponentialRampToValueAtTime =
      vi.fn<(value: number, endTime: number) => AudioParam>(assign);
    this.linearRampToValueAtTime = vi.fn<(value: number, endTime: number) => AudioParam>(assign);
    this.setTargetAtTime =
      vi.fn<(target: number, startTime: number, timeConstant: number) => AudioParam>(assign);
    this.setValueAtTime = vi.fn<(value: number, startTime: number) => AudioParam>(assign);
    this.setValueCurveAtTime =
      vi.fn<(values: Float32Array, startTime: number, duration: number) => AudioParam>(self);
  }
}

export class MockAudioNode {
  channelCount = 2;
  channelCountMode: ChannelCountMode = "max";
  channelInterpretation: ChannelInterpretation = "speakers";
  numberOfInputs = 1;
  numberOfOutputs = 1;
  readonly connect: Mock<Connect> = vi.fn<Connect>((destination) =>
    asNative<AudioNode>(destination),
  );
  readonly disconnect: Mock<Disconnect> = vi.fn<Disconnect>();
}

export class MockScheduledSourceNode extends MockAudioNode {
  readonly #endedListeners = new Set<() => void>();
  onended: (() => void) | null = null;
  readonly start: Mock<(when?: number, offset?: number, duration?: number) => void> =
    vi.fn<(when?: number, offset?: number, duration?: number) => void>();
  readonly stop: Mock<(when?: number) => void> = vi.fn<(when?: number) => void>();

  addEventListener(type: string, listener: () => void): void {
    if (type === "ended") {
      this.#endedListeners.add(listener);
    }
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === "ended") {
      this.#endedListeners.delete(listener);
    }
  }

  /**
   * Simulates the source reaching its end.
   */
  dispatchEnded(): void {
    for (const listener of Array.from(this.#endedListeners)) {
      listener();
    }

    this.onended?.();
  }
}

export class MockBufferSourceNode extends MockScheduledSourceNode {
  buffer: AudioBuffer | null = null;
  loop = false;
  loopEnd = 0;
  loopStart = 0;
  readonly detune: MockAudioParam = new MockAudioParam(0);
  readonly playbackRate: MockAudioParam = new MockAudioParam(1);
}

export class MockOscillatorNode extends MockScheduledSourceNode {
  readonly detune: MockAudioParam = new MockAudioParam(0);
  readonly frequency: MockAudioParam = new MockAudioParam(440);
  type: OscillatorType = "sine";
  readonly setPeriodicWave: Mock<(wave: PeriodicWave) => void> =
    vi.fn<(wave: PeriodicWave) => void>();
}

export class MockConstantSourceNode extends MockScheduledSourceNode {
  readonly offset: MockAudioParam = new MockAudioParam(1);
}

export class MockConvolverNode extends MockAudioNode {
  buffer: AudioBuffer | null = null;
  normalize = true;
}

export class MockWaveShaperNode extends MockAudioNode {
  curve: Float32Array | null = null;
  oversample: OverSampleType = "none";
}

type FrequencyResponse = (
  frequencyHz: Float32Array,
  magResponse: Float32Array,
  phaseResponse: Float32Array,
) => void;

export class MockBiquadFilterNode extends MockAudioNode {
  readonly Q: MockAudioParam = new MockAudioParam(1);
  readonly detune: MockAudioParam = new MockAudioParam(0);
  readonly frequency: MockAudioParam = new MockAudioParam(350);
  readonly gain: MockAudioParam = new MockAudioParam(0);
  type: BiquadFilterType = "lowpass";
  readonly getFrequencyResponse: Mock<FrequencyResponse> = vi.fn<FrequencyResponse>(
    (_frequencyHz, magResponse, phaseResponse) => {
      magResponse.fill(0.5);
      phaseResponse.fill(0);
    },
  );
}

export class MockAnalyserNode extends MockAudioNode {
  fftSize = 4;
  maxDecibels = -30;
  minDecibels = -100;
  samples: readonly number[] = [0, 0, 0, 0];
  smoothingTimeConstant = 0.8;
  readonly getFloatTimeDomainData: Mock<(array: Float32Array) => void> = vi.fn<
    (array: Float32Array) => void
  >((array: Float32Array) => {
    for (let index = 0; index < array.length; index++) {
      array[index] = this.samples[index] ?? 0;
    }
  });
}

export class MockChannelMergerNode extends MockAudioNode {
  constructor(numberOfInputs: number) {
    super();
    this.numberOfInputs = numberOfInputs;
  }
}

export class MockChannelSplitterNode extends MockAudioNode {
  constructor(numberOfOutputs: number) {
    super();
    this.numberOfOutputs = numberOfOutputs;
  }
}

export class MockDynamicsCompressorNode extends MockAudioNode {
  readonly attack: MockAudioParam = new MockAudioParam(0.003);
  readonly knee: MockAudioParam = new MockAudioParam(30);
  readonly ratio: MockAudioParam = new MockAudioParam(12);
  readonly release: MockAudioParam = new MockAudioParam(0.25);
  readonly threshold: MockAudioParam = new MockAudioParam(-24);
  reduction = -3;
}

export class MockDelayNode extends MockAudioNode {
  readonly delayTime: MockAudioParam = new MockAudioParam(0);
  readonly maxDelayTime: number | undefined;

  constructor(maxDelayTime?: number) {
    super();
    this.maxDelayTime = maxDelayTime;
  }
}

export class MockGainNode extends MockAudioNode {
  readonly gain: MockAudioParam = new MockAudioParam(1);
}

export class MockIIRFilterNode extends MockAudioNode {
  readonly feedback: readonly number[];
  readonly feedforward: readonly number[];
  readonly getFrequencyResponse: Mock<FrequencyResponse> = vi.fn<FrequencyResponse>(
    (_frequencyHz, magResponse, phaseResponse) => {
      magResponse.fill(0.75);
      phaseResponse.fill(0);
    },
  );

  constructor(feedforward: readonly number[], feedback: readonly number[]) {
    super();
    this.feedforward = feedforward;
    this.feedback = feedback;
  }
}

/**
 * Stand-in for `AudioWorkletNode`; install it with `patchGlobal("AudioWorkletNode", …)`.
 */
export class MockAudioWorkletNode extends MockAudioNode {
  readonly name: string;
  readonly options: AudioWorkletNodeOptions;
  readonly parameters: Map<string, MockAudioParam>;

  constructor(_context: BaseAudioContext, name: string, options: AudioWorkletNodeOptions = {}) {
    super();
    this.name = name;
    this.options = options;
    this.parameters = new Map(
      Object.entries(options.parameterData ?? {}).map(([key, value]) => [
        key,
        new MockAudioParam(value),
      ]),
    );
  }
}

export class MockMediaStreamTrackAudioSourceNode extends MockAudioNode {
  readonly mediaStreamTrack: MediaStreamTrack;

  constructor(mediaStreamTrack: MediaStreamTrack) {
    super();
    this.mediaStreamTrack = mediaStreamTrack;
  }
}

export class MockStereoPannerNode extends MockAudioNode {
  readonly pan: MockAudioParam = new MockAudioParam(0);
}

export class MockPannerNode extends MockAudioNode {
  coneInnerAngle = 360;
  coneOuterAngle = 360;
  coneOuterGain = 0;
  distanceModel: DistanceModelType = "inverse";
  maxDistance = 10_000;
  panningModel: PanningModelType = "equalpower";
  refDistance = 1;
  rolloffFactor = 1;
  readonly orientationX: MockAudioParam = new MockAudioParam(1);
  readonly orientationY: MockAudioParam = new MockAudioParam(0);
  readonly orientationZ: MockAudioParam = new MockAudioParam(0);
  readonly positionX: MockAudioParam = new MockAudioParam(0);
  readonly positionY: MockAudioParam = new MockAudioParam(0);
  readonly positionZ: MockAudioParam = new MockAudioParam(0);
}

export class MockAudioBuffer {
  readonly duration: number;
  readonly length: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  readonly #channels: Float32Array[];

  constructor(options: {
    readonly length: number;
    readonly numberOfChannels: number;
    readonly sampleRate: number;
  }) {
    this.length = options.length;
    this.numberOfChannels = options.numberOfChannels;
    this.sampleRate = options.sampleRate;
    this.duration = options.length / options.sampleRate;
    this.#channels = Array.from(
      { length: options.numberOfChannels },
      () => new Float32Array(options.length),
    );
  }

  getChannelData(channel: number): Float32Array {
    const data = this.#channels[channel];

    if (data === undefined) {
      throw new RangeError("channel out of range");
    }

    return data;
  }

  copyToChannel(source: Float32Array, channelNumber: number, startInChannel = 0): void {
    this.getChannelData(channelNumber).set(source, startInChannel);
  }
}

export function createMockAudioBuffer(duration = 1): AudioBuffer {
  const buffer = new MockAudioBuffer({
    length: Math.max(1, Math.floor(duration * 48_000)),
    numberOfChannels: 1,
    sampleRate: 48_000,
  });

  return asNative<AudioBuffer>(buffer);
}

type Factory<Node> = Mock<() => Node>;

/**
 * Structural `AudioContext` double. Every created node is recorded in a `created*` list.
 */
export class MockAudioContext {
  currentTime: number;
  readonly sampleRate: number;
  state: AudioContextState = "running";
  readonly destination: MockAudioNode = new MockAudioNode();
  readonly audioWorklet: MockAudioWorklet = {
    addModule: vi.fn<(url: string) => Promise<void>>(async () => undefined),
  };
  readonly #stateListeners = new Set<() => void>();

  readonly createdAnalysers: MockAnalyserNode[] = [];
  readonly createdBuffers: MockAudioBuffer[] = [];
  readonly createdCompressors: MockDynamicsCompressorNode[] = [];
  readonly createdConstantSources: MockConstantSourceNode[] = [];
  readonly createdConvolvers: MockConvolverNode[] = [];
  readonly createdDelays: MockDelayNode[] = [];
  readonly createdFilters: MockBiquadFilterNode[] = [];
  readonly createdGains: MockGainNode[] = [];
  readonly createdIIRFilters: MockIIRFilterNode[] = [];
  readonly createdMediaStreamTrackSources: MockMediaStreamTrackAudioSourceNode[] = [];
  readonly createdMergers: MockChannelMergerNode[] = [];
  readonly createdOscillators: MockOscillatorNode[] = [];
  readonly createdPanners: MockStereoPannerNode[] = [];
  readonly createdSpatialPanners: MockPannerNode[] = [];
  readonly createdSources: MockBufferSourceNode[] = [];
  readonly createdSplitters: MockChannelSplitterNode[] = [];
  readonly createdWaveShapers: MockWaveShaperNode[] = [];

  constructor(currentTime = 1, sampleRate = 48_000) {
    this.currentTime = currentTime;
    this.sampleRate = sampleRate;
  }

  readonly resume: Mock<() => Promise<void>> = vi.fn<() => Promise<void>>(async () => {
    this.setState("running");
  });
  readonly suspend: Mock<() => Promise<void>> = vi.fn<() => Promise<void>>(async () => {
    this.setState("suspended");
  });
  readonly close: Mock<() => Promise<void>> = vi.fn<() => Promise<void>>(async () => {
    this.setState("closed");
  });

  readonly addEventListener: Mock<(type: string, listener: () => void) => void> = vi.fn<
    (type: string, listener: () => void) => void
  >((type: string, listener: () => void) => {
    if (type === "statechange") {
      this.#stateListeners.add(listener);
    }
  });

  readonly removeEventListener: Mock<(type: string, listener: () => void) => void> = vi.fn<
    (type: string, listener: () => void) => void
  >((type: string, listener: () => void) => {
    if (type === "statechange") {
      this.#stateListeners.delete(listener);
    }
  });

  setState(state: AudioContextState): void {
    this.state = state;

    for (const listener of Array.from(this.#stateListeners)) {
      listener();
    }
  }

  readonly createAnalyser: Factory<AnalyserNode> = vi.fn<() => AnalyserNode>(() =>
    this.#record(this.createdAnalysers, new MockAnalyserNode()),
  );
  readonly createBiquadFilter: Factory<BiquadFilterNode> = vi.fn<() => BiquadFilterNode>(() =>
    this.#record(this.createdFilters, new MockBiquadFilterNode()),
  );
  readonly createBufferSource: Factory<AudioBufferSourceNode> = vi.fn<() => AudioBufferSourceNode>(
    () => this.#record(this.createdSources, new MockBufferSourceNode()),
  );
  readonly createConstantSource: Factory<ConstantSourceNode> = vi.fn<() => ConstantSourceNode>(() =>
    this.#record(this.createdConstantSources, new MockConstantSourceNode()),
  );
  readonly createConvolver: Factory<ConvolverNode> = vi.fn<() => ConvolverNode>(() =>
    this.#record(this.createdConvolvers, new MockConvolverNode()),
  );
  readonly createDynamicsCompressor: Factory<DynamicsCompressorNode> = vi.fn<
    () => DynamicsCompressorNode
  >(() => this.#record(this.createdCompressors, new MockDynamicsCompressorNode()));
  readonly createGain: Factory<GainNode> = vi.fn<() => GainNode>(() =>
    this.#record(this.createdGains, new MockGainNode()),
  );
  readonly createOscillator: Factory<OscillatorNode> = vi.fn<() => OscillatorNode>(() =>
    this.#record(this.createdOscillators, new MockOscillatorNode()),
  );
  readonly createPanner: Factory<PannerNode> = vi.fn<() => PannerNode>(() =>
    this.#record(this.createdSpatialPanners, new MockPannerNode()),
  );
  readonly createStereoPanner: Factory<StereoPannerNode> = vi.fn<() => StereoPannerNode>(() =>
    this.#record(this.createdPanners, new MockStereoPannerNode()),
  );
  readonly createWaveShaper: Factory<WaveShaperNode> = vi.fn<() => WaveShaperNode>(() =>
    this.#record(this.createdWaveShapers, new MockWaveShaperNode()),
  );
  readonly createDelay: Mock<(maxDelayTime?: number) => DelayNode> = vi.fn<
    (maxDelayTime?: number) => DelayNode
  >((maxDelayTime?: number) => this.#record(this.createdDelays, new MockDelayNode(maxDelayTime)));
  readonly createChannelMerger: Mock<(numberOfInputs?: number) => ChannelMergerNode> = vi.fn<
    (numberOfInputs?: number) => ChannelMergerNode
  >((numberOfInputs = 6) =>
    this.#record(this.createdMergers, new MockChannelMergerNode(numberOfInputs)),
  );
  readonly createChannelSplitter: Mock<(numberOfOutputs?: number) => ChannelSplitterNode> = vi.fn<
    (numberOfOutputs?: number) => ChannelSplitterNode
  >((numberOfOutputs = 6) =>
    this.#record(this.createdSplitters, new MockChannelSplitterNode(numberOfOutputs)),
  );
  readonly createIIRFilter: Mock<
    (feedforward: readonly number[], feedback: readonly number[]) => IIRFilterNode
  > = vi.fn<(feedforward: readonly number[], feedback: readonly number[]) => IIRFilterNode>(
    (feedforward: readonly number[], feedback: readonly number[]) =>
      this.#record(this.createdIIRFilters, new MockIIRFilterNode(feedforward, feedback)),
  );
  readonly createMediaStreamTrackSource: Mock<
    (mediaStreamTrack: MediaStreamTrack) => MediaStreamTrackAudioSourceNode
  > = vi.fn<(mediaStreamTrack: MediaStreamTrack) => MediaStreamTrackAudioSourceNode>(
    (mediaStreamTrack: MediaStreamTrack) =>
      this.#record(
        this.createdMediaStreamTrackSources,
        new MockMediaStreamTrackAudioSourceNode(mediaStreamTrack),
      ),
  );
  readonly createBuffer: Mock<
    (numberOfChannels: number, length: number, sampleRate: number) => AudioBuffer
  > = vi.fn<(numberOfChannels: number, length: number, sampleRate: number) => AudioBuffer>(
    (numberOfChannels: number, length: number, sampleRate: number) =>
      this.#record(
        this.createdBuffers,
        new MockAudioBuffer({ length, numberOfChannels, sampleRate }),
      ),
  );
  readonly createPeriodicWave: Mock<(real: Float32Array, imag: Float32Array) => PeriodicWave> =
    vi.fn<(real: Float32Array, imag: Float32Array) => PeriodicWave>(() =>
      asNative<PeriodicWave>({}),
    );
  readonly decodeAudioData: Mock<(data: ArrayBuffer) => Promise<AudioBuffer>> = vi.fn<
    (data: ArrayBuffer) => Promise<AudioBuffer>
  >(async (data: ArrayBuffer) =>
    asNative<AudioBuffer>(
      new MockAudioBuffer({
        length: data.byteLength,
        numberOfChannels: 1,
        sampleRate: this.sampleRate,
      }),
    ),
  );

  #record<Node extends object, Native>(list: Node[], node: Node): Native {
    list.push(node);

    return asNative<Native>(node);
  }
}

/**
 * Creates a mock context typed as the native `AudioContext` it stands in for.
 */
export function createMockAudioContext(
  currentTime = 1,
  sampleRate = 48_000,
): MockAudioContext & AudioContext {
  return asNative<MockAudioContext & AudioContext>(new MockAudioContext(currentTime, sampleRate));
}

export function createMockDecodeAudioContext(sampleRate = 48_000): MockAudioContext & AudioContext {
  return createMockAudioContext(0, sampleRate);
}

/**
 * Wraps a mock context in a real facade with the given look-ahead.
 */
export function createMockFacade(context: AudioContext, lookAhead = 0): OnlineAudioContextFacade {
  return new OnlineAudioContextFacade(context, { lookAhead });
}

/**
 * Replaces a global for the duration of a test. Returns a function that restores it.
 */
export function patchGlobal(key: string, value: unknown): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, value, writable: true });

  return () => {
    if (previous === undefined) {
      Reflect.deleteProperty(globalThis, key);
    } else {
      Object.defineProperty(globalThis, key, previous);
    }
  };
}

/**
 * Facade over a mock context whose time is set directly, for scheduling tests.
 */
export class MockClockContext extends AudioContextFacade {
  readonly native: MockAudioContext & AudioContext;
  readonly lookAhead: number;
  readonly resume: Mock<() => Promise<void>> = vi.fn<() => Promise<void>>(async () => undefined);
  readonly suspend: Mock<() => Promise<void>> = vi.fn<() => Promise<void>>(async () => undefined);
  readonly close: Mock<() => Promise<void>> = vi.fn<() => Promise<void>>(async () => undefined);

  constructor(currentTime = 0, lookAhead = 0.1) {
    super();
    this.native = createMockAudioContext(currentTime);
    this.lookAhead = lookAhead;
  }

  get context(): MockAudioContext & AudioContext {
    return this.native;
  }

  override get currentTime(): number {
    return this.native.currentTime;
  }

  override set currentTime(time: number) {
    this.native.currentTime = time;
  }

  override now(): number {
    return this.native.currentTime + this.lookAhead;
  }
}
