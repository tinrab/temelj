/* oxlint-disable anti-slop/no-shape-in-symbol-names -- `WaveShaper` is the Web Audio API name (`WaveShaperNode`, `BaseAudioContext.createWaveShaper()`). */
import { describe, expect, it, vi } from "vitest";

import { MockGainNode, asNative, asMock } from "../tests/audio.ts";
import {
  Follower,
  DcMeter,
  EnvelopeFollower,
  FftAnalyser,
  Meter,
  WaveformAnalyser,
  getAverageFrequency,
  getFrequencyData,
  getPeak,
  getPeakDb,
  getRms,
  getRmsDb,
  getTimeData,
  getWaveformData,
} from "./mod.ts";

class MockIIRFilterNode {
  readonly feedback: readonly number[];
  readonly feedforward: readonly number[];
  readonly connect = vi.fn<(destinationNode: AudioNode | AudioParam) => AudioNode>(() =>
    asNative<AudioNode>({}),
  );
  readonly disconnect = vi.fn<() => void>();

  constructor(feedforward: readonly number[], feedback: readonly number[]) {
    this.feedback = feedback;
    this.feedforward = feedforward;
  }
}

class MockWaveShaperNode {
  curve: Float32Array | null = null;
  oversample: OverSampleType = "none";
  readonly connect = vi.fn<(destinationNode: AudioNode | AudioParam) => AudioNode>(() =>
    asNative<AudioNode>({}),
  );
  readonly disconnect = vi.fn<() => void>();
}

class MockAnalyserNode {
  fftSize = 8;
  maxDecibels = -30;
  minDecibels = -100;
  smoothingTimeConstant = 0.8;
  readonly connect = vi.fn<(destinationNode: AudioNode | AudioParam) => AudioNode>(() =>
    asNative<AudioNode>({}),
  );
  readonly disconnect = vi.fn<() => void>();

  get frequencyBinCount(): number {
    return this.fftSize / 2;
  }

  getByteFrequencyData(target: Uint8Array): void {
    target.set([0, 64, 128, 255].slice(0, target.length));
  }

  getByteTimeDomainData(target: Uint8Array): void {
    target.set([0, 64, 128, 192, 255, 192, 128, 64].slice(0, target.length));
  }

  getFloatTimeDomainData(target: Float32Array): void {
    target.set([-1, -0.5, 0, 0.5, 1, 0.5, 0, -0.5].slice(0, target.length));
  }
}

function createMockContext(sampleRate = 48_000): BaseAudioContext & {
  readonly createdAnalysers: MockAnalyserNode[];
  readonly createdGains: MockGainNode[];
  readonly createdIIRFilters: MockIIRFilterNode[];
  readonly createdWaveShapers: MockWaveShaperNode[];
} {
  const createdAnalysers: MockAnalyserNode[] = [];
  const createdGains: MockGainNode[] = [];
  const createdIIRFilters: MockIIRFilterNode[] = [];
  const createdWaveShapers: MockWaveShaperNode[] = [];

  return asNative<
    BaseAudioContext & {
      readonly createdAnalysers: MockAnalyserNode[];
      readonly createdGains: MockGainNode[];
      readonly createdIIRFilters: MockIIRFilterNode[];
      readonly createdWaveShapers: MockWaveShaperNode[];
    }
  >({
    currentTime: 1,
    createdAnalysers,
    createdGains,
    createdIIRFilters,
    createdWaveShapers,
    destination: {},
    sampleRate,
    state: "running",
    createAnalyser: vi.fn<() => AnalyserNode>(() => {
      const node = new MockAnalyserNode();
      createdAnalysers.push(node);

      return asNative<AnalyserNode>(node);
    }),
    createGain: vi.fn<() => GainNode>(() => {
      const node = new MockGainNode();
      createdGains.push(node);

      return asNative<GainNode>(node);
    }),
    createIIRFilter: vi.fn<
      (feedforward: readonly number[], feedback: readonly number[]) => IIRFilterNode
    >((feedforward, feedback) => {
      const node = new MockIIRFilterNode(feedforward, feedback);
      createdIIRFilters.push(node);

      return asNative<IIRFilterNode>(node);
    }),
    createWaveShaper: vi.fn<() => WaveShaperNode>(() => {
      const node = new MockWaveShaperNode();
      createdWaveShapers.push(node);

      return asNative<WaveShaperNode>(node);
    }),
  });
}

function createAnalyser(): AnalyserNode {
  return asNative<AnalyserNode>(new MockAnalyserNode());
}

describe("analyser data helpers", () => {
  it("reads byte frequency data", () => {
    const data = getFrequencyData(createAnalyser());

    expect([...data]).toEqual([0, 64, 128, 255]);
  });

  it("uses caller-provided frequency buffers", () => {
    const target = new Uint8Array(2);
    const data = getFrequencyData(createAnalyser(), { target });

    expect(data).toBe(target);
    expect([...data]).toEqual([0, 64]);
  });

  it("reads byte time-domain data at fftSize length", () => {
    const data = getTimeData(createAnalyser());

    expect(data).toHaveLength(8);
    expect([...data]).toEqual([0, 64, 128, 192, 255, 192, 128, 64]);
  });

  it("reads float waveform data", () => {
    const target = new Float32Array(4);
    const data = getWaveformData(createAnalyser(), { target });

    expect(data).toBe(target);
    expect([...data]).toEqual([-1, -0.5, 0, 0.5]);
  });

  it("computes average byte frequency", () => {
    expect(getAverageFrequency(createAnalyser())).toBeCloseTo(111.75);
  });
});

describe("meter helpers", () => {
  it("computes RMS from waveform samples", () => {
    expect(getRms(createAnalyser())).toBeCloseTo(0.612_372, 5);
  });

  it("computes peak amplitude from waveform samples", () => {
    expect(getPeak(createAnalyser())).toBe(1);
  });

  it("converts RMS and peak levels to decibels", () => {
    expect(getRmsDb(createAnalyser())).toBeCloseTo(-4.26, 2);
    expect(getPeakDb(createAnalyser())).toBe(0);
  });
});

describe("EnvelopeFollower", () => {
  it("smooths RMS levels over repeated updates", () => {
    const analyser = createAnalyser();

    const follower = new EnvelopeFollower(analyser, {
      sampleRate: 10,
      smoothing: 0.1,
    });

    const coefficient = Math.exp(-1);
    const level = getRms(analyser);

    expect(follower.value).toBe(0);
    expect(follower.update()).toBeCloseTo(level * (1 - coefficient), 6);
    expect(follower.update()).toBeCloseTo(
      level * (1 - coefficient) * coefficient + level * (1 - coefficient),
      6,
    );
  });

  it("can follow peak levels and reset the smoothed state", () => {
    const follower = new EnvelopeFollower(createAnalyser(), {
      initialValue: 0.5,
      sampleRate: 10,
      smoothing: 0.1,
      usePeak: true,
    });

    expect(follower.value).toBe(0.5);
    expect(follower.update()).toBeCloseTo(0.5 * Math.exp(-1) + (1 - Math.exp(-1)), 6);

    follower.reset(0.25);
    expect(follower.value).toBe(0.25);

    follower.reset(Number.NaN);
    expect(follower.value).toBe(0);
  });

  it("uses provided waveform buffers for follower updates", () => {
    const target = new Float32Array(4);

    const follower = new EnvelopeFollower(createAnalyser(), {
      sampleRate: 10,
      smoothing: 0.1,
      target,
    });

    follower.update();

    expect([...target]).toEqual([-1, -0.5, 0, 0.5]);
  });
});

describe("Follower", () => {
  it("creates an absolute-value one-pole follower graph", () => {
    const context = createMockContext();

    const follower = new Follower(context, {
      curveLength: 5,
      smoothing: 0.25,
    });

    const abs = asMock<MockWaveShaperNode>(follower.input);
    const input = asMock<MockGainNode>(follower.filter.input);
    const output = asMock<MockGainNode>(follower.output);

    expect(follower.output).toBe(follower.filter.output);
    expect(follower.smoothing).toBe(0.25);
    expect(follower.disposed).toBe(false);
    expect(abs.curve).toBeInstanceOf(Float32Array);
    expect([...(abs.curve ?? [])]).toEqual([1, 0.5, 0, 0.5, 1]);
    expect(abs.connect).toHaveBeenCalledWith(input);
    expect(context.createdIIRFilters).toHaveLength(1);

    const firstFilter = asMock<MockIIRFilterNode>(follower.filter.filter);
    follower.setSmoothing(0.5);

    expect(follower.smoothing).toBe(0.5);
    expect(firstFilter.disconnect).toHaveBeenCalledTimes(1);
    expect(context.createdIIRFilters).toHaveLength(2);

    follower.dispose();
    follower.dispose();

    expect(follower.disposed).toBe(true);
    expect(abs.disconnect).toHaveBeenCalledTimes(1);
    expect(input.disconnect).toHaveBeenCalledTimes(2);
    expect(output.disconnect).toHaveBeenCalledTimes(1);
    expect(asMock<MockIIRFilterNode>(follower.filter.filter).disconnect).toHaveBeenCalledTimes(1);
  });

  it("uses default smoothing and rejects invalid values", () => {
    const context = createMockContext();
    const follower = new Follower(context);

    expect(follower.smoothing).toBe(0.05);
    expect(context.createdWaveShapers[0]?.curve).toHaveLength(8_192);
    expect(() => new Follower(context, { smoothing: Number.NaN })).toThrow(RangeError);
  });
});

describe("analyser handles", () => {
  it("creates an FFT analyser with byte frequency data and frequency lookup", () => {
    const context = createMockContext(48_000);

    const fft = new FftAnalyser(context, {
      fftSize: 64,
      size: 100,
      smoothingTimeConstant: 2,
    });

    const analyser = asMock<MockAnalyserNode>(fft.analyser);

    expect(fft.input).toBe(fft.output);
    expect(fft.disposed).toBe(false);
    expect(fft.output).toBe(fft.analyser);
    expect(analyser.fftSize).toBe(128);
    expect(analyser.smoothingTimeConstant).toBe(1);
    expect(fft.size).toBe(64);
    expect(fft.getFrequencyOfIndex(1)).toBe(375);

    const value = fft.getBytes();
    expect(value).toBeInstanceOf(Uint8Array);
    expect(Array.from(value.slice(0, 4))).toEqual([0, 64, 128, 255]);

    expect(() => fft.getFrequencyOfIndex(64)).toThrow(RangeError);

    fft.dispose();
    fft.dispose();
    expect(fft.disposed).toBe(true);
    expect(analyser.disconnect).toHaveBeenCalledTimes(1);
  });

  it("creates an FFT analyser with normalized frequency data", () => {
    const context = createMockContext();
    const target = new Float32Array(4);

    const fft = new FftAnalyser(context, { size: 8 });

    const value = fft.getNormalized(target);

    expect(value).toBe(target);
    expect(target[0]).toBe(0);
    expect(target[1]).toBeCloseTo(64 / 255);
    expect(target[2]).toBeCloseTo(128 / 255);
    expect(target[3]).toBe(1);
  });

  it("creates a waveform analyser with float waveform values", () => {
    const context = createMockContext();
    const target = new Float32Array(4);

    const waveform = new WaveformAnalyser(context, {
      maxDecibels: Number.NaN,
      minDecibels: -80,
      size: 10,
      smoothingTimeConstant: -1,
    });

    const analyser = asMock<MockAnalyserNode>(waveform.analyser);
    const value = waveform.getValue(target);

    expect(waveform.input).toBe(waveform.output);
    expect(waveform.disposed).toBe(false);
    expect(waveform.size).toBe(32);
    expect(analyser.minDecibels).toBe(-80);
    expect(analyser.maxDecibels).toBe(Number.NaN);
    expect(analyser.smoothingTimeConstant).toBe(0);
    expect(value).toBe(target);
    expect([...target]).toEqual([-1, -0.5, 0, 0.5]);

    waveform.dispose();
    waveform.dispose();
    expect(waveform.disposed).toBe(true);
    expect(analyser.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe("Meter", () => {
  it("reads RMS and peak levels", () => {
    const context = createMockContext();

    const meter = new Meter(context, { size: 512 });
    const analyser = asMock<MockAnalyserNode>(meter.analyser);

    expect(meter.input).toBe(meter.output);
    expect(meter.disposed).toBe(false);
    expect(meter.output).toBe(meter.analyser);
    expect(analyser.fftSize).toBe(512);
    const expectedRms = getRms(meter.analyser);
    expect(meter.getRms()).toBeCloseTo(expectedRms, 5);
    expect(meter.getPeak()).toBe(1);
    expect(meter.getLevelDb()).toBeCloseTo(getRmsDb(meter.analyser), 2);
    expect(meter.value).toBeCloseTo(expectedRms, 5);

    meter.dispose();
    meter.dispose();
    expect(meter.disposed).toBe(true);
    expect(analyser.disconnect).toHaveBeenCalledTimes(1);
  });

  it("smooths levels and supports reset", () => {
    const context = createMockContext(80);

    const meter = new Meter(context, { size: 8, smoothing: 0.1 });

    const coefficient = Math.exp(-1 / (0.1 * 2.5));
    const level = getRms(meter.analyser);

    expect(meter.getLevel()).toBeCloseTo(level * (1 - coefficient), 6);
    expect(meter.getLevel()).toBeCloseTo(
      level * (1 - coefficient) * coefficient + level * (1 - coefficient),
      6,
    );

    meter.reset(0.25);
    expect(meter.value).toBe(0.25);
  });

  it("can meter peak levels", () => {
    const meter = new Meter(createMockContext(), { usePeak: true });

    expect(meter.getLevel()).toBe(1);
    expect(meter.value).toBe(1);
  });
});

describe("DcMeter", () => {
  it("reads the current first waveform sample", () => {
    const context = createMockContext();

    const meter = new DcMeter(context, { size: 300 });
    const analyser = asMock<MockAnalyserNode>(meter.analyser);

    expect(meter.input).toBe(meter.output);
    expect(meter.disposed).toBe(false);
    expect(meter.output).toBe(meter.analyser);
    expect(analyser.fftSize).toBe(256);
    expect(meter.getValue()).toBe(-1);

    meter.dispose();
    meter.dispose();
    expect(meter.disposed).toBe(true);
    expect(analyser.disconnect).toHaveBeenCalledTimes(1);
  });
});
