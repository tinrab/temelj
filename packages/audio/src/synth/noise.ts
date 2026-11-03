import type { AudioContextLike } from "../context/context.ts";
import type { NoiseType, NoiseRandomSource } from "../source/noise.ts";
import type { TimeExpression } from "../time/time.ts";
import type { SynthReleaseOptions, SynthTriggerOptions } from "./base.ts";
import type { EnvelopeOptions } from "./envelope.ts";

import {
  createBiquadFilterNode,
  createBufferSourceNode,
  createGainNode,
  stopQuietly,
} from "../native.ts";
import { createNoiseBuffer } from "../source/noise.ts";
import { toSeconds } from "../time/time.ts";
import { SynthBase } from "./base.ts";
import { Envelope } from "./envelope.ts";
import { resolveRelease, SynthVoiceBase } from "./voice.ts";

export type NoiseSynthOptions = {
  readonly envelope?: EnvelopeOptions;
  readonly filter?: BiquadFilterOptions;
  readonly mute?: boolean;
  readonly noise?: {
    readonly duration?: number;
    readonly random?: NoiseRandomSource;
    readonly seed?: number;
    readonly type?: NoiseType;
  };
  readonly volume?: number;
};

/**
 * Looping noise buffer through an optional filter and an amplitude envelope.
 */
export class NoiseSynthVoice extends SynthVoiceBase {
  readonly filter: BiquadFilterNode | undefined;
  readonly source: AudioBufferSourceNode;
  readonly #envelope: Envelope;
  readonly #gain: GainNode;

  constructor(
    context: AudioContextLike,
    owner: unknown[],
    nodes: {
      readonly envelope: Envelope;
      readonly filter: BiquadFilterNode | undefined;
      readonly gain: GainNode;
      readonly source: AudioBufferSourceNode;
      readonly startedAt: number;
    },
  ) {
    super(context, owner, nodes.startedAt);
    this.filter = nodes.filter;
    this.source = nodes.source;
    this.#envelope = nodes.envelope;
    this.#gain = nodes.gain;
    this.disposeWhenEnded(this.source);
  }

  protected releaseAt(time: number): void {
    this.#envelope.triggerRelease(this.#gain.gain, time, { now: this.now() });
    stopQuietly(this.source, time + resolveRelease(this.#envelope));
  }

  protected teardown(now: number): void {
    stopQuietly(this.source, now);
    this.source.disconnect();
    this.filter?.disconnect();
    this.#gain.disconnect();
  }
}

/**
 * Unpitched noise through an optional filter and an amplitude envelope.
 */
export class NoiseSynth extends SynthBase<NoiseSynthVoice> {
  readonly envelope: Envelope;
  readonly #options: NoiseSynthOptions;

  constructor(context: AudioContextLike, options: NoiseSynthOptions = {}) {
    super(context, options);
    this.#options = options;
    this.envelope = new Envelope({
      attack: 0.005,
      decay: 0.1,
      release: 0.1,
      sustain: 0,
      ...options.envelope,
    });
  }

  triggerAttack({
    time = this.immediate(),
    velocity = 1,
  }: SynthTriggerOptions = {}): NoiseSynthVoice {
    const options = this.#options;
    const startTime = this.resolveTime(time);

    const source = createBufferSourceNode(this.nativeContext, {
      buffer: createNoiseBuffer(this.context, {
        duration: options.noise?.duration ?? 1,
        numberOfChannels: 1,
        random: options.noise?.random,
        seed: options.noise?.seed,
        type: options.noise?.type ?? "white",
      }),
      loop: true,
    });

    const gain = createGainNode(this.nativeContext, { gain: 0 });

    const filter =
      options.filter === undefined
        ? undefined
        : createBiquadFilterNode(this.nativeContext, options.filter);

    if (filter === undefined) {
      source.connect(gain);
    } else {
      source.connect(filter);
      filter.connect(gain);
    }

    gain.connect(this.volume);
    this.envelope.triggerAttack(gain.gain, startTime, { now: this.immediate(), velocity });
    source.start(startTime);

    const voice = new NoiseSynthVoice(this.context, this.voices, {
      envelope: this.envelope,
      filter,
      gain,
      source,
      startedAt: startTime,
    });

    this.voices.push(voice);

    return voice;
  }

  triggerAttackRelease(
    duration: TimeExpression,
    { time = this.immediate(), velocity = 1 }: SynthTriggerOptions = {},
  ): NoiseSynthVoice {
    const voice = this.triggerAttack({ time, velocity });
    voice.release(this.resolveTime(time) + toSeconds(duration));

    return voice;
  }

  triggerRelease({ time = this.immediate() }: SynthReleaseOptions = {}): void {
    for (const voice of Array.from(this.voices)) {
      voice.release(time);
    }
  }
}
