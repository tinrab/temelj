import type { AudioContextLike } from "../context/context.ts";
import type { NoiseType, NoiseRandomSource } from "../source/noise.ts";
import type { TimeExpression } from "../time/time.ts";
import type { SynthTriggerOptions } from "./base.ts";
import type { NoteExpression } from "./voice.ts";

import {
  createBiquadFilterNode,
  createBufferSourceNode,
  createConstantSourceNode,
  createDelayNode,
  createGainNode,
  stopQuietly,
} from "../native.ts";
import { createNoiseBuffer } from "../source/noise.ts";
import { toSeconds } from "../time/time.ts";
import { clampNormal, requirePositive } from "../validation.ts";
import { NoteSynth } from "./base.ts";
import { resolveFrequency, SynthVoiceBase } from "./voice.ts";

export type PluckSynthOptions = {
  readonly attackNoise?: number;
  readonly dampening?: number;
  readonly mute?: boolean;
  readonly noise?: {
    readonly random?: NoiseRandomSource;
    readonly seed?: number;
    readonly type?: NoiseType;
  };
  readonly release?: TimeExpression;
  readonly resonance?: number;
  readonly volume?: number;
};

/**
 * Karplus-Strong string: noise burst into a filtered feedback delay. Release fades the feedback.
 */
export class PluckSynthVoice extends SynthVoiceBase {
  readonly dampening: BiquadFilterNode;
  readonly delay: DelayNode;
  readonly feedback: GainNode;
  readonly note: NoteExpression;
  readonly source: AudioBufferSourceNode;
  readonly #outputGain: GainNode;
  readonly #release: TimeExpression;
  readonly #tail: ConstantSourceNode;

  constructor(
    context: AudioContextLike,
    owner: unknown[],
    nodes: {
      readonly dampening: BiquadFilterNode;
      readonly delay: DelayNode;
      readonly feedback: GainNode;
      readonly note: NoteExpression;
      readonly outputGain: GainNode;
      readonly release: TimeExpression;
      readonly source: AudioBufferSourceNode;
      readonly startedAt: number;
      /**
       * Silent source that runs until the release ends, so the voice knows when it is done.
       */
      readonly tail: ConstantSourceNode;
    },
  ) {
    super(context, owner, nodes.startedAt);
    this.dampening = nodes.dampening;
    this.delay = nodes.delay;
    this.feedback = nodes.feedback;
    this.note = nodes.note;
    this.source = nodes.source;
    this.#outputGain = nodes.outputGain;
    this.#release = nodes.release;
    this.#tail = nodes.tail;
    this.disposeWhenEnded(this.#tail);
  }

  protected releaseAt(time: number): void {
    const gain = this.feedback.gain;
    gain.cancelScheduledValues(time);
    gain.setValueAtTime(gain.value, time);
    gain.linearRampToValueAtTime(0, time + toSeconds(this.#release));
    stopQuietly(this.#tail, time + toSeconds(this.#release));
  }

  protected teardown(now: number): void {
    stopQuietly(this.source, now);
    stopQuietly(this.#tail, now);
    this.#tail.disconnect();
    this.source.disconnect();
    this.delay.disconnect();
    this.dampening.disconnect();
    this.feedback.disconnect();
    this.#outputGain.disconnect();
  }
}

/**
 * Karplus-Strong plucked string: a noise burst excites a filtered feedback delay tuned to the note.
 *
 * The tuning depends on how the engine runs a `DelayNode` inside a feedback loop, and the Web Audio
 * spec makes such a delay at least one 128-frame render quantum. Measured at 44.1 kHz in Firefox
 * 158, notes up to E4 come within 2% of their pitch, but A4 and A5 both play near 339 Hz. Chromium
 * 155 adds about 130 frames to every period, so A4 plays near 192 Hz. Other engines have not been
 * measured.
 */
export class PluckSynth extends NoteSynth<PluckSynthVoice> {
  readonly attackNoise: number;
  readonly dampening: number;
  readonly release: TimeExpression;
  readonly resonance: number;
  readonly #options: PluckSynthOptions;

  constructor(context: AudioContextLike, options: PluckSynthOptions = {}) {
    super(context, options);
    this.#options = options;
    this.attackNoise = requirePositive(options.attackNoise ?? 1, "attackNoise");
    this.dampening = requirePositive(options.dampening ?? 4_000, "dampening");
    this.release = options.release ?? 1;
    this.resonance = clampNormal(options.resonance ?? 0.7, "resonance");
  }

  triggerAttack(
    note: NoteExpression,
    { time = this.immediate(), velocity = 1 }: SynthTriggerOptions = {},
  ): PluckSynthVoice {
    const nativeContext = this.nativeContext;
    const noiseOptions = this.#options.noise;
    const startTime = this.resolveTime(time);
    const delayTime = 1 / resolveFrequency(note);

    const source = createBufferSourceNode(nativeContext, {
      buffer: createNoiseBuffer(this.context, {
        duration: Math.max(delayTime * this.attackNoise, 1 / nativeContext.sampleRate),
        numberOfChannels: 1,
        random: noiseOptions?.random,
        seed: noiseOptions?.seed,
        type: noiseOptions?.type ?? "pink",
      }),
    });

    const delay = createDelayNode(nativeContext, {
      delayTime,
      maxDelayTime: Math.max(1, delayTime * 2),
    });

    const filter = createBiquadFilterNode(nativeContext, {
      frequency: this.dampening,
      type: "lowpass",
    });

    const feedback = createGainNode(nativeContext, { gain: 0 });
    const outputGain = createGainNode(nativeContext, { gain: clampNormal(velocity, "velocity") });

    source.connect(delay);
    delay.connect(filter);
    filter.connect(feedback);
    feedback.connect(delay);
    filter.connect(outputGain);
    outputGain.connect(this.volume);
    delay.delayTime.setValueAtTime(delayTime, startTime);
    feedback.gain.setValueAtTime(this.resonance, startTime);
    source.start(startTime);
    stopQuietly(source, startTime + delayTime * this.attackNoise);

    // Silent, but connected so the engine processes it and fires `ended` when it stops.
    const tail = createConstantSourceNode(nativeContext, { offset: 0 });
    tail.connect(outputGain);
    tail.start(startTime);

    const voice = new PluckSynthVoice(this.context, this.voices, {
      dampening: filter,
      delay,
      feedback,
      note,
      outputGain,
      release: this.release,
      source,
      startedAt: startTime,
      tail,
    });

    this.voices.push(voice);

    return voice;
  }
}
