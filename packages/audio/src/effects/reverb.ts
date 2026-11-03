import type { AudioContextLike } from "../context/context.ts";

import { createAudioBuffer } from "../buffer/creation.ts";
import { connectSeries, createBiquadFilterNode, createConvolverNode } from "../native.ts";
import { createNoiseRandom } from "../source/noise.ts";
import { AudioNodeUnit } from "../unit.ts";
import {
  clampNormal,
  requireFinite,
  requireNonNegative,
  requirePositive,
  snapToFrame,
} from "../validation.ts";
import { FeedbackCombFilter, LowpassCombFilter } from "./filter.ts";

export type JCReverbOptions = {
  readonly roomSize?: number;
  readonly wet?: number;
};

export type FreeverbOptions = {
  readonly dampening?: number;
  readonly roomSize?: number;
  readonly wet?: number;
};

export type ConvolutionReverbOptions = {
  /**
   * Length in seconds of the impulse response after `preDelay`. The noise decays by about 52 dB
   * over that time.
   */
  readonly decay?: number;
  readonly preDelay?: number;
  readonly seed?: number;
  readonly wet?: number;
};

const JC_REVERB_COMB_DELAY_TIMES = [1687 / 25_000, 1601 / 25_000, 2053 / 25_000, 2251 / 25_000];

const JC_REVERB_ALLPASS_FREQUENCIES = [347, 113, 37];

const FREEVERB_COMB_DELAY_TIMES = [
  1557 / 44_100,
  1617 / 44_100,
  1491 / 44_100,
  1422 / 44_100,
  1277 / 44_100,
  1356 / 44_100,
  1188 / 44_100,
  1116 / 44_100,
];

const FREEVERB_ALLPASS_FREQUENCIES = [225, 556, 441, 341];

/**
 * Dry path plus a wet send: subclasses route `input` through their reverb into `wetGain`.
 */
abstract class Reverb extends AudioNodeUnit {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly wetGain: GainNode;

  constructor(context: AudioContextLike, wet: number) {
    super(context);
    this.input = this.createGain();
    this.output = this.createGain();
    this.wetGain = this.createGain(clampNormal(wet, "wet"));
    this.input.connect(this.createGain()).connect(this.output);
    this.wetGain.connect(this.output);
  }

  get wet(): AudioParam {
    return this.wetGain.gain;
  }

  setWet(value: number, time: number = this.now()): void {
    this.wetGain.gain.setValueAtTime(clampNormal(value, "wet"), time);
  }

  protected allpass(frequency: number): BiquadFilterNode {
    return this.nodes.add(createBiquadFilterNode(this.native, { frequency, type: "allpass" }));
  }
}

/**
 * Convolver fed with a generated, exponentially decaying noise impulse response.
 */
export class ConvolutionReverb extends Reverb {
  readonly convolver: ConvolverNode;
  readonly #seed: number;
  #decay: number;
  #preDelay: number;

  constructor(context: AudioContextLike, options: ConvolutionReverbOptions = {}) {
    super(context, options.wet ?? 1);
    this.#seed = requireFinite(options.seed ?? 1, "seed");
    this.#decay = requirePositive(options.decay ?? 1.5, "decay");
    this.#preDelay = requireNonNegative(options.preDelay ?? 0.01, "preDelay");
    this.convolver = this.nodes.add(createConvolverNode(this.native));
    connectSeries(this.input, this.convolver, this.wetGain);
    this.generate();
  }

  get decay(): number {
    return this.#decay;
  }

  get preDelay(): number {
    return this.#preDelay;
  }

  /**
   * Regenerates the impulse response from the current settings.
   */
  generate(): AudioBuffer {
    const buffer = createImpulseResponse(this.native, this.#decay, this.#preDelay, this.#seed);
    this.convolver.buffer = buffer;

    return buffer;
  }

  setDecay(value: number): void {
    this.#decay = requirePositive(value, "decay");
    this.generate();
  }

  setPreDelay(value: number): void {
    this.#preDelay = requireNonNegative(value, "preDelay");
    this.generate();
  }
}

/**
 * Freeverb: eight parallel low-pass comb filters into two all-pass chains.
 */
export class Freeverb extends Reverb {
  readonly combFilters: readonly LowpassCombFilter[];
  #dampening: number;
  #roomSize: number;

  constructor(context: AudioContextLike, options: FreeverbOptions = {}) {
    super(context, options.wet ?? 1);
    this.#dampening = requirePositive(options.dampening ?? 3_000, "dampening");
    this.#roomSize = clampNormal(options.roomSize ?? 0.7, "roomSize");

    const allpassChain = (): BiquadFilterNode => {
      const [first, ...rest] = FREEVERB_ALLPASS_FREQUENCIES.map((frequency) =>
        this.allpass(frequency),
      );

      // SAFETY: FREEVERB_ALLPASS_FREQUENCIES is a non-empty constant.
      const head = first as BiquadFilterNode;
      connectSeries(head, ...rest, this.wetGain);

      return head;
    };

    const left = allpassChain();
    const right = allpassChain();
    this.combFilters = FREEVERB_COMB_DELAY_TIMES.map((delayTime, index) => {
      const comb = new LowpassCombFilter(context, {
        dampening: this.#dampening,
        delayTime,
        resonance: this.#roomSize,
      });

      this.input.connect(comb.input);
      comb.connect(index < FREEVERB_COMB_DELAY_TIMES.length / 2 ? left : right);

      return comb;
    });
  }

  get dampening(): number {
    return this.#dampening;
  }

  get roomSize(): number {
    return this.#roomSize;
  }

  setDampening(value: number, time: number = this.now()): void {
    this.#dampening = requirePositive(value, "dampening");

    for (const comb of this.combFilters) {
      comb.setDampening(this.#dampening, time);
    }
  }

  setRoomSize(value: number, time: number = this.now()): void {
    this.#roomSize = clampNormal(value, "roomSize");

    for (const comb of this.combFilters) {
      comb.setResonance(this.#roomSize, time);
    }
  }

  protected override teardown(): void {
    for (const comb of this.combFilters) {
      comb.dispose();
    }
  }
}

/**
 * Schroeder reverb: three all-pass filters into four parallel feedback comb filters.
 */
export class JCReverb extends Reverb {
  readonly combFilters: readonly FeedbackCombFilter[];
  #roomSize: number;

  constructor(context: AudioContextLike, options: JCReverbOptions = {}) {
    super(context, options.wet ?? 1);
    this.#roomSize = clampNormal(options.roomSize ?? 0.5, "roomSize");
    const allpasses = JC_REVERB_ALLPASS_FREQUENCIES.map((frequency) => this.allpass(frequency));
    connectSeries(this.input, ...allpasses);
    const combInput = allpasses.at(-1) ?? this.input;
    this.combFilters = JC_REVERB_COMB_DELAY_TIMES.map((delayTime) => {
      const comb = new FeedbackCombFilter(context, {
        delayTime,
        resonance: jcResonance(this.#roomSize),
      });

      combInput.connect(comb.input);
      comb.connect(this.wetGain);

      return comb;
    });
  }

  get roomSize(): number {
    return this.#roomSize;
  }

  setRoomSize(value: number, time: number = this.now()): void {
    this.#roomSize = clampNormal(value, "roomSize");

    for (const comb of this.combFilters) {
      comb.setResonance(jcResonance(this.#roomSize), time);
    }
  }

  protected override teardown(): void {
    for (const comb of this.combFilters) {
      comb.dispose();
    }
  }
}

/**
 * Maps room size [0, 1] to comb feedback [-0.733, 0.197].
 */
function jcResonance(roomSize: number): number {
  return -0.733 + roomSize * (0.197 + 0.733);
}

function createImpulseResponse(
  context: BaseAudioContext,
  decay: number,
  preDelay: number,
  seed: number,
): AudioBuffer {
  const { sampleRate } = context;
  const length = Math.max(1, Math.floor(snapToFrame((decay + preDelay) * sampleRate)));
  const preDelayFrames = Math.min(length, Math.floor(snapToFrame(preDelay * sampleRate)));
  const buffer = createAudioBuffer({ length, numberOfChannels: 2, sampleRate });
  const random = createNoiseRandom(seed);

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);

    for (let frame = preDelayFrames; frame < data.length; frame++) {
      const elapsed = (frame - preDelayFrames) / sampleRate;
      data[frame] = (random() * 2 - 1) * Math.exp((-6 * elapsed) / decay);
    }
  }

  return buffer;
}
