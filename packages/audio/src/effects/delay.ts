import type { AudioContextLike } from "../context/context.ts";
import type {
  BiquadFilterBlueprint,
  BlueprintParamsOf,
  GainBlueprint,
} from "../graph/blueprint.ts";

import { BLUEPRINT_PARAM_KEYS, Blueprint, biquadFilter, gain } from "../graph/blueprint.ts";
import { createBiquadFilterNode, createDelayNode, createStereoPannerNode } from "../native.ts";
import { AudioNodeUnit } from "../unit.ts";
import { clampNormal, requireNonNegative, requirePositive } from "../validation.ts";

export type PingPongDelayOptions = {
  readonly delayTime?: number;
  readonly feedback?: number;
  readonly maxDelayTime?: number;
  readonly wet?: number;
};

export type FeedbackDelayOptions = DelayOptions & {
  readonly feedback?: number;
};

export type DubDelayBlueprintOptions = {
  /**
   * Low-pass cutoff in the feedback loop, in hertz.
   */
  readonly cutoff?: number;
  readonly delayTime?: number;
  readonly feedback?: number;
  readonly maxDelayTime?: number;
};

export type DubDelayOptions = {
  readonly cutoff?: number;
  readonly delayTime?: number;
  readonly feedback?: number;
  readonly maxDelayTime?: number;
  readonly mix?: number;
};

/**
 * Stereo echo that alternates between the left and right channels, one `delayTime` apart. Each
 * round trip back to the left is scaled by `feedback`.
 */
export class PingPongDelay extends AudioNodeUnit {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #delays: readonly DelayNode[];
  readonly #feedback: GainNode;
  readonly #wet: GainNode;

  constructor(context: AudioContextLike, options: PingPongDelayOptions = {}) {
    super(context);
    const delayTime = requireNonNegative(options.delayTime ?? 0.25, "delayTime");

    const maxDelayTime = requirePositive(
      options.maxDelayTime ?? Math.max(1, delayTime * 2),
      "maxDelayTime",
    );

    const delay = (): DelayNode =>
      this.nodes.add(createDelayNode(this.native, { delayTime, maxDelayTime }));

    const panner = (pan: number): StereoPannerNode =>
      this.nodes.add(createStereoPannerNode(this.native, { pan }));

    this.input = this.createGain();
    this.output = this.createGain();
    this.#wet = this.createGain(clampNormal(options.wet ?? 1, "wet"));
    this.#feedback = this.createGain(clampNormal(options.feedback ?? 0.2, "feedback"));
    const left = delay();
    const right = delay();
    this.#delays = [left, right];

    // The lines are chained so echoes alternate: left after one delay, right after two, then
    // back to the left through the feedback gain.
    this.input.connect(left).connect(panner(-1)).connect(this.#wet);
    left.connect(right).connect(panner(1)).connect(this.#wet);
    right.connect(this.#feedback).connect(left);
    this.#wet.connect(this.output);
  }

  /**
   * Delay time of the left line. Automating it leaves the right line unchanged; `setDelayTime()`
   * sets both.
   */
  get delayTime(): AudioParam {
    // SAFETY: the constructor always creates two delay lines.
    return (this.#delays[0] as DelayNode).delayTime;
  }

  get feedback(): AudioParam {
    return this.#feedback.gain;
  }

  get wet(): AudioParam {
    return this.#wet.gain;
  }

  setDelayTime(value: number, time: number = this.now()): void {
    const delayTime = requireNonNegative(value, "delayTime");

    for (const delay of this.#delays) {
      delay.delayTime.setValueAtTime(delayTime, time);
    }
  }

  setFeedback(value: number, time: number = this.now()): void {
    this.#feedback.gain.setValueAtTime(clampNormal(value, "feedback"), time);
  }

  setWet(value: number, time: number = this.now()): void {
    this.#wet.gain.setValueAtTime(clampNormal(value, "wet"), time);
  }
}

/**
 * Delay line that feeds its output back into itself.
 */
export class FeedbackDelayBlueprint extends Blueprint<
  "delay",
  DelayOptions,
  BlueprintParamsOf<"delay">
> {
  readonly feedback: GainBlueprint;

  constructor(options: FeedbackDelayOptions = {}) {
    const { feedback = 0.35, ...delayOptions } = options;
    super("delay", delayOptions, BLUEPRINT_PARAM_KEYS.delay);
    this.feedback = gain({ gain: clampNormal(feedback, "feedback") });
    this.connect(this.feedback);
    this.feedback.connect(this);
  }
}

/**
 * Creates a feedback delay blueprint: the delayed signal is fed back into the delay, scaled by
 * `feedback`. The output is fully wet; to hear the dry signal too, connect the source to the
 * destination as well.
 */
export function feedbackDelay(options: FeedbackDelayOptions = {}): FeedbackDelayBlueprint {
  return new FeedbackDelayBlueprint(options);
}

/**
 * Delay line with a low-pass filter in its feedback loop.
 */
export class DubDelayBlueprint extends Blueprint<
  "delay",
  DelayOptions,
  BlueprintParamsOf<"delay">
> {
  readonly feedback: GainBlueprint;
  readonly filter: BiquadFilterBlueprint;

  constructor(options: DubDelayBlueprintOptions = {}) {
    super(
      "delay",
      {
        delayTime: requireNonNegative(options.delayTime ?? 0.25, "delayTime"),
        maxDelayTime: options.maxDelayTime,
      },
      BLUEPRINT_PARAM_KEYS.delay,
    );
    this.filter = biquadFilter({
      frequency: requirePositive(options.cutoff ?? 700, "cutoff"),
      type: "lowpass",
    });
    this.feedback = gain({ gain: clampNormal(options.feedback ?? 0.6, "feedback") });
    this.connect(this.filter);
    this.filter.connect(this.feedback);
    this.feedback.connect(this);
  }
}

/**
 * Creates a dub-style feedback delay blueprint with a low-pass filter in the feedback loop, so each
 * repeat has less high end than the one before.
 */
export function dubDelay(options: DubDelayBlueprintOptions = {}): DubDelayBlueprint {
  return new DubDelayBlueprint(options);
}

/**
 * Feedback delay with a low-pass filter in the loop and a dry/wet mix.
 */
export class DubDelay extends AudioNodeUnit {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly delay: DelayNode;
  readonly filter: BiquadFilterNode;
  readonly #dry: GainNode;
  readonly #wet: GainNode;
  readonly #feedback: GainNode;
  #mix: number;

  constructor(context: AudioContextLike, options: DubDelayOptions = {}) {
    super(context);
    const delayTime = requireNonNegative(options.delayTime ?? 0.25, "delayTime");
    this.#mix = clampNormal(options.mix ?? 0.5, "mix");
    this.input = this.createGain();
    this.output = this.createGain();
    this.#dry = this.createGain(1 - this.#mix);
    this.#wet = this.createGain(this.#mix);
    this.#feedback = this.createGain(clampNormal(options.feedback ?? 0.6, "feedback"));
    this.delay = this.nodes.add(
      createDelayNode(this.native, {
        delayTime,
        maxDelayTime: requirePositive(
          options.maxDelayTime ?? Math.max(1, delayTime * 2),
          "maxDelayTime",
        ),
      }),
    );
    this.filter = this.nodes.add(
      createBiquadFilterNode(this.native, {
        frequency: requirePositive(options.cutoff ?? 700, "cutoff"),
        type: "lowpass",
      }),
    );

    this.input.connect(this.#dry).connect(this.output);
    this.input.connect(this.delay).connect(this.filter);
    this.filter.connect(this.#wet).connect(this.output);
    this.filter.connect(this.#feedback).connect(this.delay);
  }

  get cutoff(): AudioParam {
    return this.filter.frequency;
  }

  get delayTime(): AudioParam {
    return this.delay.delayTime;
  }

  get feedback(): AudioParam {
    return this.#feedback.gain;
  }

  get mix(): number {
    return this.#mix;
  }

  setCutoff(value: number, time: number = this.now()): void {
    this.filter.frequency.setValueAtTime(requirePositive(value, "cutoff"), time);
  }

  setDelayTime(value: number, time: number = this.now()): void {
    this.delay.delayTime.setValueAtTime(requireNonNegative(value, "delayTime"), time);
  }

  setFeedback(value: number, time: number = this.now()): void {
    this.#feedback.gain.setValueAtTime(clampNormal(value, "feedback"), time);
  }

  setMix(value: number, time: number = this.now()): void {
    this.#mix = clampNormal(value, "mix");
    this.#dry.gain.setValueAtTime(1 - this.#mix, time);
    this.#wet.gain.setValueAtTime(this.#mix, time);
  }
}
