import type { AudioContextLike } from "../context/context.ts";
import type { SynthTriggerOptions } from "./base.ts";
import type { EnvelopeOptions } from "./envelope.ts";
import type { NoteExpression } from "./voice.ts";

import { createBiquadFilterNode, createGainNode } from "../native.ts";
import { FMOscillator } from "../source/oscillator.ts";
import { toSeconds } from "../time/time.ts";
import { requireFinite, requireNonNegative, requirePositive } from "../validation.ts";
import { NoteSynth } from "./base.ts";
import { Envelope } from "./envelope.ts";
import { resolveFrequency, resolveRelease, SynthVoiceBase } from "./voice.ts";

export type MetalSynthOptions = {
  readonly detune?: number;
  readonly envelope?: EnvelopeOptions;
  readonly harmonicity?: number;
  readonly modulationIndex?: number;
  readonly mute?: boolean;
  readonly octaves?: number;
  readonly resonance?: number;
  readonly volume?: number;
};

/**
 * Six FM oscillators through a high-pass filter and an amplitude envelope.
 */
export class MetalSynthVoice extends SynthVoiceBase {
  readonly amplitude: GainNode;
  readonly highpass: BiquadFilterNode;
  readonly note: NoteExpression;
  readonly oscillators: readonly FMOscillator[];
  readonly #envelope: Envelope;

  constructor(
    context: AudioContextLike,
    owner: unknown[],
    nodes: {
      readonly amplitude: GainNode;
      readonly envelope: Envelope;
      readonly highpass: BiquadFilterNode;
      readonly note: NoteExpression;
      readonly oscillators: readonly FMOscillator[];
      readonly startedAt: number;
    },
  ) {
    super(context, owner, nodes.startedAt);
    this.note = nodes.note;
    this.oscillators = nodes.oscillators;
    this.amplitude = nodes.amplitude;
    this.#envelope = nodes.envelope;
    this.highpass = nodes.highpass;
    this.oscillators[0]?.onEnded(() => this.dispose());
  }

  protected releaseAt(time: number): void {
    this.#envelope.triggerRelease(this.amplitude.gain, time, { now: this.now() });

    for (const oscillator of this.oscillators) {
      oscillator.stop(time + resolveRelease(this.#envelope));
    }
  }

  protected teardown(now: number): void {
    for (const oscillator of this.oscillators) {
      oscillator.stop(now);
      oscillator.dispose();
    }

    this.highpass.disconnect();
    this.amplitude.disconnect();
  }
}

const METAL_SYNTH_RATIOS = [1, 1.483, 1.932, 2.546, 2.63, 3.897] as const;

/**
 * Cymbal-like synth: six FM oscillators at inharmonic frequency ratios through a high-pass filter.
 * Despite its name, `resonance` sets that filter's cutoff in hertz (4000 by default); the filter
 * itself has no resonant peak.
 */
export class MetalSynth extends NoteSynth<MetalSynthVoice> {
  readonly envelope: Envelope;
  readonly detune: number;
  #harmonicity: number;
  #modulationIndex: number;
  #octaves: number;
  #resonance: number;

  constructor(context: AudioContextLike, options: MetalSynthOptions = {}) {
    super(context, options);
    this.envelope = new Envelope({
      attack: 0.001,
      attackCurve: "linear",
      decay: 1.4,
      release: 0.2,
      sustain: 0,
      ...options.envelope,
    });
    this.detune = requireFinite(options.detune ?? 0, "detune");
    this.#harmonicity = requirePositive(options.harmonicity ?? 5.1, "harmonicity");
    this.#modulationIndex = requirePositive(options.modulationIndex ?? 32, "modulationIndex");
    this.#octaves = requireNonNegative(options.octaves ?? 1.5, "octaves");
    this.#resonance = requirePositive(options.resonance ?? 4_000, "resonance");
  }

  get harmonicity(): number {
    return this.#harmonicity;
  }

  get modulationIndex(): number {
    return this.#modulationIndex;
  }

  get octaves(): number {
    return this.#octaves;
  }

  get resonance(): number {
    return this.#resonance;
  }

  setHarmonicity(harmonicity: number): void {
    this.#harmonicity = requirePositive(harmonicity, "harmonicity");

    for (const voice of this.voices) {
      for (const oscillator of voice.oscillators) {
        oscillator.setHarmonicity(this.#harmonicity);
      }
    }
  }

  setModulationIndex(index: number): void {
    this.#modulationIndex = requirePositive(index, "modulationIndex");

    for (const voice of this.voices) {
      for (const oscillator of voice.oscillators) {
        oscillator.setModulationIndex(this.#modulationIndex);
      }
    }
  }

  setOctaves(octaves: number): void {
    this.#octaves = requireNonNegative(octaves, "octaves");
  }

  setResonance(resonance: number): void {
    this.#resonance = requirePositive(resonance, "resonance");
  }

  triggerAttack(
    note: NoteExpression,
    { time = this.immediate(), velocity = 1 }: SynthTriggerOptions = {},
  ): MetalSynthVoice {
    const startTime = this.resolveTime(time);
    const frequency = resolveFrequency(note);
    const amplitude = createGainNode(this.nativeContext, { gain: 0 });

    const highpass = createBiquadFilterNode(this.nativeContext, {
      Q: 0,
      frequency: this.#resonance,
      type: "highpass",
    });

    const oscillators = METAL_SYNTH_RATIOS.map((ratio) => {
      const oscillator = new FMOscillator(this.context, {
        detune: this.detune,
        frequency: frequency * ratio,
        harmonicity: this.#harmonicity,
        modulationIndex: this.#modulationIndex,
        modulationType: "square",
        type: "square",
      });

      oscillator.output.connect(highpass);
      oscillator.start(startTime);

      return oscillator;
    });

    highpass.connect(amplitude);
    amplitude.connect(this.volume);
    scheduleMetalFilterEnvelope(
      highpass.frequency,
      this.envelope,
      this.#resonance,
      this.#octaves,
      startTime,
    );
    this.envelope.triggerAttack(amplitude.gain, startTime, { now: this.immediate(), velocity });

    if (this.envelope.sustain === 0) {
      const stopTime = startTime + toSeconds(this.envelope.attack) + toSeconds(this.envelope.decay);

      for (const oscillator of oscillators) {
        oscillator.stop(stopTime);
      }
    }

    const voice = new MetalSynthVoice(this.context, this.voices, {
      amplitude,
      envelope: this.envelope,
      highpass,
      note,
      oscillators,
      startedAt: startTime,
    });

    this.voices.push(voice);

    return voice;
  }
}

function scheduleMetalFilterEnvelope(
  frequency: AudioParam,
  envelope: Envelope,
  resonance: number,
  octaves: number,
  startTime: number,
): void {
  const attack = toSeconds(envelope.attack);
  const decay = toSeconds(envelope.decay);
  const maxFrequency = resonance * 2 ** octaves;
  frequency.cancelScheduledValues?.(startTime);
  frequency.setValueAtTime(resonance, startTime);
  frequency.linearRampToValueAtTime(maxFrequency, startTime + attack);
  frequency.exponentialRampToValueAtTime(
    Math.max(resonance, 0.000_001),
    startTime + attack + decay,
  );
}
