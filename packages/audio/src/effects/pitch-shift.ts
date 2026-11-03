/* oxlint-disable anti-slop/no-shape-in-symbol-names -- `WaveShaper` is the Web Audio API name (`WaveShaperNode`, `BaseAudioContext.createWaveShaper()`). */
import type { AudioContextLike } from "../context/context.ts";
import type { RunState } from "../unit.ts";

import { createAudioBuffer } from "../buffer/creation.ts";
import { AudioDisposedError } from "../errors.ts";
import {
  createBufferSourceNode,
  createDelayNode,
  createGainNode,
  createWaveShaperNode,
} from "../native.ts";
import { intervalToFrequencyRatio } from "../time/pitch.ts";
import { AudioNodeUnit } from "../unit.ts";
import {
  clampNormal,
  requireFinite,
  requireInRange,
  requireNonNegative,
  requirePositive,
} from "../validation.ts";
import { createWaveShaperMap } from "./waveshaper.ts";

export type PitchShiftOptions = {
  /**
   * Delay in seconds of the feedback delay after the shifter. Defaults to 0.
   */
  readonly delayTime?: number;
  /**
   * Feedback of the delay after the shifter, from 0 to 1. Defaults to 0.
   */
  readonly feedback?: number;
  /**
   * Shift in semitones. Defaults to 0.
   */
  readonly pitch?: number;
  /**
   * Level of the shifted signal added to the unchanged input, from 0 to 1. Defaults to 1.
   */
  readonly wet?: number;
  /**
   * Length in seconds of each delay sweep, up to 1. Defaults to 0.1.
   */
  readonly windowSize?: number;
};

const MAX_WINDOW_SIZE = 1;

const CURVE_LENGTH = 4_096;

/**
 * Rate of the sawtooth sweep that shifts by `pitch` semitones. A delay that changes at `d`
 * seconds per second plays back at `1 - d` times the input frequency, and each sweep moves the
 * delay by one window.
 */
function getSweepFrequency(pitch: number, windowSize: number): number {
  return Math.abs(intervalToFrequencyRatio(pitch) - 1) / windowSize;
}

/**
 * Delay-line pitch shifter. Two delay lines sweep through a `windowSize` window half a period
 * apart, and each fades out while its delay jumps back, so the sum plays continuously at the
 * shifted pitch. The shifted signal goes through an optional feedback delay and is added,
 * scaled by `wet`, to the unchanged input.
 */
export class PitchShift extends AudioNodeUnit {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #wet: GainNode;
  readonly #feedback: GainNode;
  readonly #feedbackDelay: DelayNode;
  readonly #sweep: AudioBufferSourceNode;
  readonly #delays: readonly DelayNode[];
  readonly #sweepDepths: readonly GainNode[];
  #pitch: number;
  #windowSize: number;
  #state: RunState = "stopped";

  constructor(context: AudioContextLike, options: PitchShiftOptions = {}) {
    super(context);
    const native = this.native;
    const nodes = this.nodes;
    const gain = (value: number): GainNode => nodes.add(createGainNode(native, { gain: value }));

    const curveNode = (mapping: (value: number) => number): WaveShaperNode =>
      nodes.add(
        createWaveShaperNode(native, { curve: createWaveShaperMap(mapping, CURVE_LENGTH) }),
      );

    const delay = (): DelayNode =>
      nodes.add(createDelayNode(native, { delayTime: 0, maxDelayTime: MAX_WINDOW_SIZE }));

    this.#pitch = requireFinite(options.pitch ?? 0, "pitch");
    this.#windowSize = requireWindowSize(options.windowSize ?? 0.1);
    this.input = gain(1);
    this.output = gain(1);
    this.#wet = gain(clampNormal(options.wet ?? 1, "wet"));
    this.#feedback = gain(clampNormal(options.feedback ?? 0, "feedback"));

    this.#feedbackDelay = nodes.add(
      createDelayNode(native, {
        delayTime: requireNonNegative(options.delayTime ?? 0, "delayTime"),
        maxDelayTime: 1,
      }),
    );

    // One sawtooth drives both lines. The second line follows the same ramp half a period later,
    // and each line's gain is 0 at the ends of its ramp, where its delay jumps back. The ramp is a
    // looping buffer rather than an oscillator: a band-limited sawtooth rings near its jump, and
    // that ringing frequency-modulates the delayed signal.
    this.#sweep = nodes.addSource(
      createBufferSourceNode(native, { buffer: createSweepRamp(native.sampleRate), loop: true }),
    );
    const halfPeriodLater = curveNode((value) => (value < 0 ? value + 1 : value - 1));
    const fadeA = gain(0);
    const fadeB = gain(0);
    const delayA = delay();
    const delayB = delay();
    const depthA = gain(0);
    const depthB = gain(0);
    this.#delays = [delayA, delayB];
    this.#sweepDepths = [depthA, depthB];

    this.#sweep.connect(depthA).connect(delayA.delayTime);
    this.#sweep.connect(halfPeriodLater).connect(depthB).connect(delayB.delayTime);
    this.#sweep.connect(curveNode((value) => 1 - Math.abs(value))).connect(fadeA.gain);
    this.#sweep.connect(curveNode((value) => Math.abs(value))).connect(fadeB.gain);

    this.input.connect(gain(1)).connect(this.output);
    this.input.connect(delayA).connect(fadeA).connect(this.#feedbackDelay);
    this.input.connect(delayB).connect(fadeB).connect(this.#feedbackDelay);
    this.#feedbackDelay.connect(this.#feedback).connect(this.#feedbackDelay);
    this.#feedbackDelay.connect(this.#wet).connect(this.output);
    this.#applyPitch(native.currentTime);
  }

  get state(): RunState {
    return this.#state;
  }

  get pitch(): number {
    return this.#pitch;
  }

  get windowSize(): number {
    return this.#windowSize;
  }

  get delayTime(): AudioParam {
    return this.#feedbackDelay.delayTime;
  }

  get feedback(): AudioParam {
    return this.#feedback.gain;
  }

  get wet(): AudioParam {
    return this.#wet.gain;
  }

  start(time: number = this.now()): void {
    this.#assertUsable();

    if (this.#state === "started") {
      return;
    }

    this.#state = "started";
    this.#sweep.start(time);
  }

  stop(time: number = this.now()): void {
    if (this.#state === "stopped") {
      return;
    }

    this.#state = "stopped";
    this.#sweep.stop(time);
  }

  setPitch(pitch: number, time: number = this.now()): void {
    this.#pitch = requireFinite(pitch, "pitch");
    this.#applyPitch(time);
  }

  /**
   * Sets the sweep length and retunes the sweep rate to keep the same shift.
   *
   * @throws {AudioRangeError} When `windowSize` is not above 0 and at most 1 second.
   */
  setWindowSize(windowSize: number, time: number = this.now()): void {
    this.#windowSize = requireWindowSize(windowSize);
    this.#applyPitch(time);
  }

  setDelayTime(delayTime: number, time: number = this.now()): void {
    this.delayTime.setValueAtTime(requireNonNegative(delayTime, "delayTime"), time);
  }

  setFeedback(feedback: number, time: number = this.now()): void {
    this.feedback.setValueAtTime(clampNormal(feedback, "feedback"), time);
  }

  setWet(wet: number, time: number = this.now()): void {
    this.wet.setValueAtTime(clampNormal(wet, "wet"), time);
  }

  protected override teardown(): void {
    this.#state = "stopped";
  }

  #applyPitch(time: number): void {
    // The ramp lasts one second, so the playback rate is the sweep frequency.
    this.#sweep.playbackRate.setValueAtTime(getSweepFrequency(this.#pitch, this.#windowSize), time);

    // Each delay is `windowSize / 2 + depth * ramp` for a ramp from -1 to 1. Shifting up needs a
    // shrinking delay, so the depth is negative; shifting down needs a growing one.
    const center = this.#windowSize / 2;
    const depth = this.#pitch > 0 ? -center : center;

    for (const delayNode of this.#delays) {
      delayNode.delayTime.setValueAtTime(center, time);
    }

    for (const sweepDepth of this.#sweepDepths) {
      sweepDepth.gain.setValueAtTime(depth, time);
    }
  }

  #assertUsable(): void {
    if (this.disposed) {
      AudioDisposedError.disposed("pitch shift");
    }
  }
}

/**
 * One second of a linear ramp from -1 to 1, looped to make a sawtooth.
 */
function createSweepRamp(sampleRate: number): AudioBuffer {
  const length = Math.round(sampleRate);
  const ramp = Float32Array.from({ length }, (_value, index) => (index / length) * 2 - 1);

  return createAudioBuffer({ channels: [ramp], sampleRate });
}

function requireWindowSize(windowSize: number): number {
  return requireInRange(
    requirePositive(windowSize, "windowSize"),
    0,
    MAX_WINDOW_SIZE,
    "windowSize",
  );
}
