import type { AudioContextLike } from "../context/context.ts";

import { getNativeAudioContext } from "../context/context.ts";
import { addAudioWorkletModule } from "../context/worklet.ts";
import { AudioGraphError, AudioUnsupportedError } from "../errors.ts";
import { AudioNodeUnit } from "../unit.ts";
import { clampNormal, requireNonNegative } from "../validation.ts";

export type ReverseDelayOptions = {
  readonly delayTime?: number;
  readonly feedback?: number;
  readonly wet?: number;
  readonly workletUrl?: string | URL;
};

/**
 * Delay that plays each `delayTime` window of input backwards one window later, built on an
 * AudioWorklet. The input also passes through unchanged, and `wet` (0.5 by default) scales the
 * reversed signal. Create it with `ReverseDelay.create()`, which registers the worklet module.
 */
export class ReverseDelay extends AudioNodeUnit {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly wetGain: GainNode;
  readonly #workletUrl: string | URL | undefined;
  #worklet: AudioWorkletNode;
  #delayTime: number;
  #feedback: number;

  constructor(
    context: AudioContextLike,
    worklet: AudioWorkletNode,
    options: ReverseDelayOptions = {},
  ) {
    super(context);
    this.#workletUrl = options.workletUrl;
    this.#delayTime = requireNonNegative(options.delayTime ?? 1, "delayTime");
    this.#feedback = clampNormal(options.feedback ?? 0.5, "feedback");
    this.input = this.createGain();
    this.output = this.createGain();
    this.wetGain = this.createGain(clampNormal(options.wet ?? 0.5, "wet"));
    this.input.connect(this.createGain()).connect(this.output);
    this.wetGain.connect(this.output);
    this.#worklet = worklet;
    this.#connectWorklet();
  }

  static async create(
    context: AudioContextLike,
    options: ReverseDelayOptions = {},
  ): Promise<ReverseDelay> {
    const worklet = await createReverseDelayWorklet(getNativeAudioContext(context), {
      delayTime: requireNonNegative(options.delayTime ?? 1, "delayTime"),
      feedback: clampNormal(options.feedback ?? 0.5, "feedback"),
      workletUrl: options.workletUrl,
    });

    return new ReverseDelay(context, worklet, options);
  }

  get delayTime(): number {
    return this.#delayTime;
  }

  get feedback(): AudioParam {
    return getFeedbackParam(this.#worklet);
  }

  get wet(): AudioParam {
    return this.wetGain.gain;
  }

  get worklet(): AudioWorkletNode {
    return this.#worklet;
  }

  /**
   * Sets the window length. The worklet reads the delay time once, so this builds a new worklet
   * node and swaps it in.
   */
  async setDelayTime(value: number): Promise<void> {
    const delayTime = requireNonNegative(value, "delayTime");

    const worklet = await createReverseDelayWorklet(this.native, {
      delayTime,
      feedback: this.#feedback,
      workletUrl: this.#workletUrl,
    });

    this.input.disconnect(this.#worklet);
    this.#worklet.disconnect();
    this.#worklet = worklet;
    this.#delayTime = delayTime;
    this.#connectWorklet();
  }

  setFeedback(value: number, time: number = this.now()): void {
    this.#feedback = clampNormal(value, "feedback");
    this.feedback.setValueAtTime(this.#feedback, time);
  }

  setWet(value: number, time: number = this.now()): void {
    this.wetGain.gain.setValueAtTime(clampNormal(value, "wet"), time);
  }

  protected override teardown(): void {
    this.#worklet.disconnect();
  }

  #connectWorklet(): void {
    this.input.connect(this.#worklet).connect(this.wetGain);
  }
}

const REVERSE_DELAY_WORKLET_NAME = "temelj-reverse-delay";

const REVERSE_DELAY_WORKLET_SOURCE = `
class TemeljReverseDelayProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: "feedback", defaultValue: 0.5, minValue: 0, maxValue: 0.9999, automationRate: "k-rate" }];
  }

  constructor(options) {
    super();
    const delayTime = Math.max(1, Math.floor(sampleRate * (options.processorOptions?.delayTime ?? 1)));
    const channels = Math.max(1, options.outputChannelCount?.[0] ?? options.channelCount ?? 2);
    this.delayTime = delayTime;
    this.position = 0;
    this.buffers = Array.from({ length: channels }, () => new Float32Array(delayTime * 2));
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    const feedbackValues = parameters.feedback;
    const blockSize = output[0]?.length ?? 0;
    for (let i = 0; i < blockSize; i++) {
      const position = this.position;
      for (let channel = 0; channel < output.length; channel++) {
        const out = output[channel];
        const source = input[channel] ?? input[0];
        const buffer = this.buffers[channel] ?? this.buffers[0];
        if (!out || !buffer) {
          continue;
        }
        const feedback = feedbackValues.length > 1 ? feedbackValues[i] : feedbackValues[0];
        // The buffer holds two windows. While one fills, the previous one plays from its newest
        // sample back to its oldest.
        const offset = position % this.delayTime;
        const windowStart = position - offset;
        const reverseIndex = (windowStart - 1 - offset + buffer.length) % buffer.length;
        // Feedback comes from one window earlier, so every repeat also plays reversed.
        const delayed = buffer[(position + this.delayTime) % buffer.length] ?? 0;
        out[i] = buffer[reverseIndex] ?? 0;
        buffer[position] = (source?.[i] ?? 0) + delayed * (feedback ?? 0.5);
      }
      this.position = (this.position + 1) % (this.buffers[0]?.length ?? 1);
    }
    return true;
  }
}
registerProcessor("${REVERSE_DELAY_WORKLET_NAME}", TemeljReverseDelayProcessor);
`;

let reverseDelayWorkletUrl: string | undefined;

const registeredReverseDelayContexts = new WeakSet<BaseAudioContext>();

async function createReverseDelayWorklet(
  context: BaseAudioContext,
  options: Required<Pick<ReverseDelayOptions, "delayTime" | "feedback">> &
    Pick<ReverseDelayOptions, "workletUrl">,
): Promise<AudioWorkletNode> {
  await registerReverseDelayWorklet(context, options.workletUrl);

  const node = createAudioWorkletNode(context, REVERSE_DELAY_WORKLET_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    parameterData: { feedback: options.feedback },
    processorOptions: { delayTime: options.delayTime },
  });

  getFeedbackParam(node).setValueAtTime(options.feedback, context.currentTime);

  return node;
}

async function registerReverseDelayWorklet(
  context: BaseAudioContext,
  workletUrl: string | URL | undefined,
): Promise<void> {
  if (registeredReverseDelayContexts.has(context)) {
    return;
  }

  if (workletUrl !== undefined) {
    await addAudioWorkletModule(context, workletUrl);
    registeredReverseDelayContexts.add(context);

    return;
  }

  if (typeof Blob === "undefined" || !(URL.createObjectURL instanceof Function)) {
    AudioUnsupportedError.missingApi("URL.createObjectURL");
  }

  reverseDelayWorkletUrl ??= URL.createObjectURL(
    new Blob([REVERSE_DELAY_WORKLET_SOURCE], { type: "text/javascript" }),
  );
  await addAudioWorkletModule(context, reverseDelayWorkletUrl);
  registeredReverseDelayContexts.add(context);
}

function createAudioWorkletNode(
  context: BaseAudioContext,
  name: string,
  options: AudioWorkletNodeOptions,
): AudioWorkletNode {
  if (typeof AudioWorkletNode === "undefined") {
    AudioUnsupportedError.missingApi("AudioWorkletNode");
  }

  return new AudioWorkletNode(context, name, options);
}

function getFeedbackParam(node: AudioWorkletNode): AudioParam {
  return (
    node.parameters.get("feedback") ??
    AudioGraphError.missingParam(REVERSE_DELAY_WORKLET_NAME, "feedback")
  );
}
