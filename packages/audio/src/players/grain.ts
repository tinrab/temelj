import type { AudioSourceInput } from "../buffer/loading.ts";
import type { AudioContextLike } from "../context/context.ts";
import type { TimeExpression } from "../time/time.ts";
import type { RunState } from "../unit.ts";

import { resolveAudioBuffer } from "../buffer/source.ts";
import { intervalToFrequencyRatio } from "../time/pitch.ts";
import { toSeconds } from "../time/time.ts";
import { requireFinite, requireNonNegative, requirePositive } from "../validation.ts";
import { BufferVoice, OutputUnit } from "./playback.ts";

export type GrainPlayerOptions = {
  /**
   * Pitch offset in cents, applied on top of the playback rate.
   */
  readonly detune?: number;
  readonly grainSize?: TimeExpression;
  readonly loop?: boolean;
  readonly loopEnd?: TimeExpression;
  readonly loopStart?: TimeExpression;
  readonly mute?: boolean;
  readonly onStop?: (grain: BufferVoice) => void;
  /**
   * Length of the crossfade between neighboring grains.
   */
  readonly overlap?: TimeExpression;
  readonly playbackRate?: number;
  readonly volume?: number;
};

export type GrainPlayerStartOptions = {
  readonly time?: TimeExpression;
  readonly offset?: TimeExpression;
  /**
   * Buffer time to cover with grains. Defaults to the rest of the buffer; when looping, grains
   * keep coming until `stop()`.
   */
  readonly duration?: TimeExpression;
};

/**
 * How far ahead of the audio clock a looping stream schedules grains, in seconds.
 */
const STREAM_LOOK_AHEAD = 0.25;

/**
 * How often a looping stream schedules more grains, in milliseconds.
 */
const STREAM_INTERVAL_MS = 100;

/**
 * Grains still to schedule for a loop that plays until stopped.
 */
type GrainStream = {
  nextTime: number;
  position: number;
  timer: ReturnType<typeof setTimeout> | undefined;
};

/**
 * Granular player: schedules overlapping grains of `grainSize` (0.2 s by default) so playback rate
 * and pitch can change independently.
 */
export class GrainPlayer extends OutputUnit {
  readonly buffer: AudioBuffer;
  readonly #grains: BufferVoice[] = [];
  readonly #onStop: ((grain: BufferVoice) => void) | undefined;
  #detune: number;
  #grainSize: number;
  #loop: boolean;
  #loopStart = 0;
  #loopEnd = 0;
  #overlap: number;
  #playbackRate: number;
  #stream: GrainStream | undefined;

  constructor(context: AudioContextLike, buffer: AudioBuffer, options: GrainPlayerOptions = {}) {
    super(context, options);
    this.buffer = buffer;
    this.#onStop = options.onStop;
    this.#detune = requireFinite(options.detune ?? 0, "detune");
    this.#grainSize = requirePositive(toSeconds(options.grainSize ?? 0.2), "grainSize");
    this.#loop = options.loop === true;
    this.#overlap = Math.min(this.#grainSize, toNonNegative(options.overlap ?? 0.1, "overlap"));
    this.#playbackRate = requirePositive(options.playbackRate ?? 1, "playbackRate");
    this.setLoopPoints(options.loopStart ?? 0, options.loopEnd ?? buffer.duration);
  }

  static async load(
    context: AudioContextLike,
    source: AudioSourceInput,
    options: GrainPlayerOptions = {},
  ): Promise<GrainPlayer> {
    return new GrainPlayer(context, await resolveAudioBuffer(context, source), options);
  }

  get activeGrains(): readonly BufferVoice[] {
    return [...this.#grains];
  }

  get detune(): number {
    return this.#detune;
  }

  get duration(): number {
    return this.buffer.duration;
  }

  get grainSize(): number {
    return this.#grainSize;
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

  get overlap(): number {
    return this.#overlap;
  }

  get playbackRate(): number {
    return this.#playbackRate;
  }

  get state(): RunState {
    return this.#stream !== undefined || this.#grains.length > 0 ? "started" : "stopped";
  }

  /**
   * Schedules grains for the requested window and returns them. When looping without a
   * `duration`, grains keep coming until `stop()` and this returns the first ones; that mode
   * needs a running context, so pass a `duration` for offline rendering.
   */
  start(options: GrainPlayerStartOptions = {}): readonly BufferVoice[] {
    const startTime = this.resolveTime(options.time);
    const offset = clampTime(toSeconds(options.offset ?? 0), 0, this.buffer.duration);

    if (this.#loop && options.duration === undefined) {
      this.#stopStream();
      this.#stream = { nextTime: startTime, position: offset, timer: undefined };

      return this.#fillStream();
    }

    const window =
      options.duration === undefined
        ? Math.max(0, this.buffer.duration - offset)
        : toSeconds(options.duration);

    const interval = this.#grainSize / this.#playbackRate;
    // Each grain advances the buffer by one grain size, whatever the playback rate.
    const count = Math.max(1, Math.ceil(window / this.#grainSize));

    return Array.from({ length: count }, (_, index) =>
      this.#startGrain(startTime + index * interval, offset + index * this.#grainSize),
    );
  }

  stop(time?: TimeExpression): void {
    const stopTime = this.resolveTime(time);
    this.#stopStream();

    for (const grain of Array.from(this.#grains)) {
      grain.stop(stopTime, 0);
    }
  }

  setDetune(detune: number): void {
    this.#detune = requireFinite(detune, "detune");
  }

  setGrainSize(grainSize: TimeExpression): void {
    this.#grainSize = requirePositive(toSeconds(grainSize), "grainSize");
    this.#overlap = Math.min(this.#overlap, this.#grainSize);
  }

  /**
   * Turning looping off ends a running loop stream; grains already scheduled still play.
   */
  setLoop(loop: boolean): void {
    this.#loop = loop;

    if (!loop) {
      this.#stopStream();
    }
  }

  setLoopPoints(start: TimeExpression, end: TimeExpression): void {
    this.#loopStart = clampTime(toSeconds(start), 0, this.buffer.duration);
    this.#loopEnd = clampTime(toSeconds(end), this.#loopStart, this.buffer.duration);
  }

  setOverlap(overlap: TimeExpression): void {
    this.#overlap = Math.min(this.#grainSize, toNonNegative(overlap, "overlap"));
  }

  setPlaybackRate(playbackRate: number): void {
    this.#playbackRate = requirePositive(playbackRate, "playbackRate");
  }

  protected override teardown(): void {
    this.#stopStream();

    for (const grain of Array.from(this.#grains)) {
      grain.dispose();
    }
  }

  /**
   * Starts one grain at `time` reading the buffer from `position`, with the current settings.
   */
  #startGrain(time: number, position: number): BufferVoice {
    const interval = this.#grainSize / this.#playbackRate;
    const fade = Math.min(this.#overlap, interval / 2);
    const playbackRate = this.#playbackRate * intervalToFrequencyRatio(this.#detune / 100);

    const grain = new BufferVoice(
      this.context,
      this.#grains,
      { buffer: this.buffer, destination: this.output, playbackRate },
      this.#onStop,
    );

    this.#grains.push(grain);

    return grain.start({
      // Each grain runs `fade` past the next grain's start, so the fade-out and the next
      // fade-in overlap and sum to a constant level. Durations are in buffer seconds.
      duration: (interval + fade) * playbackRate,
      fadeIn: fade,
      fadeOut: fade,
      offset: this.#grainOffset(position),
      time,
    });
  }

  /**
   * Schedules the loop stream's grains up to the look-ahead horizon, then checks again after
   * `STREAM_INTERVAL_MS`.
   */
  #fillStream(): BufferVoice[] {
    const stream = this.#stream;

    if (stream === undefined) {
      return [];
    }

    const horizon = this.now() + STREAM_LOOK_AHEAD;
    const grains: BufferVoice[] = [];

    while (stream.nextTime < horizon) {
      grains.push(this.#startGrain(stream.nextTime, stream.position));
      stream.nextTime += this.#grainSize / this.#playbackRate;
      stream.position += this.#grainSize;
    }

    stream.timer = setTimeout(() => {
      this.#fillStream();
    }, STREAM_INTERVAL_MS);

    return grains;
  }

  #stopStream(): void {
    if (this.#stream?.timer !== undefined) {
      clearTimeout(this.#stream.timer);
    }

    this.#stream = undefined;
  }

  #grainOffset(position: number): number {
    if (!this.#loop) {
      return clampTime(position, 0, this.buffer.duration);
    }

    const length = Math.max(this.#grainSize, this.#loopEnd - this.#loopStart);

    return this.#loopStart + ((((position - this.#loopStart) % length) + length) % length);
  }
}

function toNonNegative(time: TimeExpression, name: string): number {
  return requireNonNegative(toSeconds(time), name);
}

function clampTime(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, requireFinite(value, "time")));
}
