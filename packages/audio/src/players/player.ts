import type { AudioSourceInput } from "../buffer/loading.ts";
import type { AudioContextLike } from "../context/context.ts";
import type { TimeExpression } from "../time/time.ts";
import type { FadeCurve, RunState } from "../unit.ts";

import { reverseAudioBuffer } from "../buffer/editing.ts";
import { resolveAudioBuffer } from "../buffer/source.ts";
import { toSeconds } from "../time/time.ts";
import { requireNonNegative, requirePositive } from "../validation.ts";
import { BufferVoice, OutputUnit, requireFadeCurve, toNonNegativeSeconds } from "./playback.ts";

export type PlayerOptions = {
  readonly autostart?: boolean;
  readonly fadeCurve?: FadeCurve;
  readonly fadeIn?: TimeExpression;
  readonly fadeOut?: TimeExpression;
  readonly loop?: boolean;
  readonly loopEnd?: TimeExpression;
  readonly loopStart?: TimeExpression;
  readonly mute?: boolean;
  /**
   * Called once per voice when it stops or ends.
   */
  readonly onStop?: (voice: BufferVoice) => void;
  readonly playbackRate?: number;
  readonly reverse?: boolean;
  readonly volume?: number;
};

export type PlayerStartOptions = {
  readonly time?: TimeExpression;
  /**
   * Buffer offset. Defaults to the loop start when looping, otherwise 0.
   */
  readonly offset?: TimeExpression;
  /**
   * Buffer time to play. Defaults to the rest of the buffer, or forever when looping.
   */
  readonly duration?: TimeExpression;
  /**
   * Per-voice gain in addition to the output volume.
   */
  readonly gain?: number;
};

/**
 * Plays one buffer, optionally looped or reversed. Every `start()` creates an independent voice
 * with its own fade-in and fade-out.
 */
export class Player extends OutputUnit {
  readonly #source: AudioBuffer;
  readonly #voices: BufferVoice[] = [];
  readonly #onStop: ((voice: BufferVoice) => void) | undefined;
  #buffer: AudioBuffer;
  #fadeCurve: FadeCurve;
  #fadeIn: number;
  #fadeOut: number;
  #loop: boolean;
  #loopStart = 0;
  #loopEnd = 0;
  #playbackRate: number;
  #reverse: boolean;

  constructor(context: AudioContextLike, buffer: AudioBuffer, options: PlayerOptions = {}) {
    super(context, options);
    this.#source = buffer;
    this.#reverse = options.reverse === true;
    this.#buffer = this.#reverse ? reverseAudioBuffer(buffer) : buffer;
    this.#fadeCurve = requireFadeCurve(options.fadeCurve ?? "linear");
    this.#fadeIn = toNonNegativeSeconds(options.fadeIn ?? 0, "fadeIn");
    this.#fadeOut = toNonNegativeSeconds(options.fadeOut ?? 0, "fadeOut");
    this.#loop = options.loop === true;
    this.#onStop = options.onStop;
    this.#playbackRate = requirePositive(options.playbackRate ?? 1, "playbackRate");
    this.#setLoopPoints(options.loopStart ?? 0, options.loopEnd ?? buffer.duration);

    if (options.autostart === true) {
      this.start();
    }
  }

  /**
   * Loads `source` and creates a player for it.
   */
  static async load(
    context: AudioContextLike,
    source: AudioSourceInput,
    options: PlayerOptions = {},
  ): Promise<Player> {
    return new Player(context, await resolveAudioBuffer(context, source), options);
  }

  get activeVoices(): readonly BufferVoice[] {
    return [...this.#voices];
  }

  get buffer(): AudioBuffer {
    return this.#buffer;
  }

  get duration(): number {
    return this.#buffer.duration;
  }

  get fadeCurve(): FadeCurve {
    return this.#fadeCurve;
  }

  get fadeIn(): number {
    return this.#fadeIn;
  }

  get fadeOut(): number {
    return this.#fadeOut;
  }

  get loop(): boolean {
    return this.#loop;
  }

  get loopStart(): number {
    return this.#loopStart;
  }

  get loopEnd(): number {
    return this.#loopEnd;
  }

  get playbackRate(): number {
    return this.#playbackRate;
  }

  get reverse(): boolean {
    return this.#reverse;
  }

  get state(): RunState {
    return this.#voices.length > 0 ? "started" : "stopped";
  }

  /**
   * Buffer position of the newest voice, wrapped into the loop when looping.
   */
  get progress(): number {
    const voice = this.#voices.at(-1);

    if (voice === undefined) {
      return 0;
    }

    const position = voice.positionAt(this.now());

    if (this.#loop) {
      const length = this.#loopEnd - this.#loopStart;

      return length <= 0
        ? this.#loopStart
        : this.#loopStart + positiveModulo(position - this.#loopStart, length);
    }

    return position >= this.#buffer.duration ? 0 : Math.max(0, position);
  }

  start(options: PlayerStartOptions = {}): BufferVoice {
    const time = this.resolveTime(options.time);

    const offset = clampTime(
      toSeconds(options.offset ?? (this.#loop ? this.#loopStart : 0)),
      0,
      this.#buffer.duration,
    );

    const duration =
      options.duration === undefined
        ? this.#loop
          ? undefined
          : this.#buffer.duration - offset
        : toSeconds(options.duration);

    const voice = new BufferVoice(
      this.context,
      this.#voices,
      {
        buffer: this.#buffer,
        destination: this.output,
        fadeCurve: this.#fadeCurve,
        loop: this.#loop,
        loopEnd: this.#loopEnd,
        loopStart: this.#loopStart,
        playbackRate: this.#playbackRate,
      },
      this.#onStop,
    );

    this.#voices.push(voice);

    return voice.start({
      duration,
      fadeIn: this.#fadeIn,
      fadeOut: this.#fadeOut,
      gain: requireNonNegative(options.gain ?? 1, "gain"),
      offset,
      time,
    });
  }

  stop(time?: TimeExpression): void {
    const stopTime = this.resolveTime(time);

    for (const voice of Array.from(this.#voices)) {
      voice.stop(stopTime, this.#fadeOut);
    }
  }

  restart(options: PlayerStartOptions = {}): BufferVoice {
    this.stop(options.time);

    return this.start(options);
  }

  /**
   * Stops every voice and starts one new voice from `offset`. Does nothing when no voice is
   * playing.
   */
  seek(offset: TimeExpression, time?: TimeExpression): BufferVoice | undefined {
    if (this.#voices.length === 0) {
      return undefined;
    }

    return this.restart({ offset, time });
  }

  setFadeCurve(curve: FadeCurve): void {
    this.#fadeCurve = requireFadeCurve(curve);
  }

  setFadeIn(fadeIn: TimeExpression): void {
    this.#fadeIn = toNonNegativeSeconds(fadeIn, "fadeIn");
  }

  setFadeOut(fadeOut: TimeExpression): void {
    this.#fadeOut = toNonNegativeSeconds(fadeOut, "fadeOut");
  }

  setLoop(loop: boolean): void {
    this.#loop = loop;

    for (const voice of this.#voices) {
      voice.source.loop = loop;
    }
  }

  setLoopPoints(start: TimeExpression, end: TimeExpression): void {
    this.#setLoopPoints(start, end);

    for (const voice of this.#voices) {
      voice.source.loopStart = this.#loopStart;
      voice.source.loopEnd = this.#loopEnd;
    }
  }

  setPlaybackRate(playbackRate: number, time?: TimeExpression): void {
    this.#playbackRate = requirePositive(playbackRate, "playbackRate");
    const at = this.resolveTime(time);

    for (const voice of this.#voices) {
      voice.source.playbackRate.setValueAtTime(this.#playbackRate, at);
    }
  }

  /**
   * Plays the buffer backwards from the next `start()`.
   */
  setReverse(reverse: boolean): void {
    if (this.#reverse !== reverse) {
      this.#reverse = reverse;
      this.#buffer = reverse ? reverseAudioBuffer(this.#source) : this.#source;
    }
  }

  protected override teardown(): void {
    for (const voice of Array.from(this.#voices)) {
      voice.dispose();
    }
  }

  #setLoopPoints(start: TimeExpression, end: TimeExpression): void {
    this.#loopStart = clampTime(toSeconds(start), 0, this.#buffer.duration);
    this.#loopEnd = clampTime(toSeconds(end), this.#loopStart, this.#buffer.duration);
  }
}

function clampTime(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, requireNonNegative(value, "time")));
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
