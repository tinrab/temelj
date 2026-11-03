import type { AudioContextLike } from "../context/context.ts";
import type { PlayerBlueprint } from "../graph/blueprint.ts";
import type { PlayHandle } from "../graph/patch.ts";
import type { TimeExpression } from "../time/time.ts";
import type { RunState } from "../unit.ts";

import { AudioRangeError } from "../errors.ts";
import { playPlayer } from "../graph/patch.ts";

export type PlaylistTrack = {
  readonly player: PlayerBlueprint;
  readonly weight?: number;
};

export type PlaylistOptions = {
  readonly tracks?: readonly (PlayerBlueprint | PlaylistTrack)[];
  readonly context: AudioContextLike;
  readonly loop?: boolean;
  readonly shuffle?: boolean;
};

export type PlaylistPlayOptions = {
  readonly at?: TimeExpression;
  readonly offset?: number;
  readonly duration?: number;
};

/**
 * Plays player blueprints one after another, optionally looping and shuffling. Shuffle picks the
 * next track at random, weighted by each track's `weight`.
 */
export class Playlist {
  #currentHandle: PlayHandle | undefined;
  #currentIndex = -1;
  #disposed = false;
  #tracks: PlaylistTrack[];

  readonly context: AudioContextLike;
  loop: boolean;
  shuffle: boolean;

  constructor(options: PlaylistOptions) {
    this.#tracks = options.tracks?.map(normalizeTrack) ?? [];
    this.context = options.context;
    this.loop = options.loop ?? false;
    this.shuffle = options.shuffle ?? false;
  }

  get currentIndex(): number {
    return this.#currentIndex;
  }

  get currentTrack(): PlaylistTrack | undefined {
    if (this.#currentIndex < 0) {
      return undefined;
    }

    return this.#tracks[this.#currentIndex];
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get length(): number {
    return this.#tracks.length;
  }

  get state(): RunState {
    return this.#currentHandle === undefined ? "stopped" : "started";
  }

  get tracks(): readonly PlaylistTrack[] {
    return this.#tracks;
  }

  add(track: PlayerBlueprint | PlaylistTrack): this {
    this.#tracks.push(normalizeTrack(track));

    return this;
  }

  remove(index: number): PlaylistTrack | undefined {
    if (index < 0 || index >= this.#tracks.length) {
      return undefined;
    }

    const [removed] = this.#tracks.splice(index, 1);

    if (index === this.#currentIndex) {
      this.stop();
      this.#currentIndex = -1;
    } else if (index < this.#currentIndex) {
      this.#currentIndex -= 1;
    }

    return removed;
  }

  clear(): void {
    this.stop();
    this.#tracks = [];
    this.#currentIndex = -1;
  }

  play(index: number = this.#resolveNextIndex(), options: PlaylistPlayOptions = {}): PlayHandle {
    if (index < 0 || index >= this.#tracks.length) {
      AudioRangeError.outOfRange("track index", index, 0, this.#tracks.length - 1);
    }

    this.stop();
    this.#currentIndex = index;
    const track = this.#tracks[index]!;

    const handle = playPlayer(this.context, track.player, {
      at: options.at,
      offset: options.offset,
      duration: options.duration,
    });

    this.#currentHandle = handle;

    void handle.finished.then(() => {
      if (this.#currentHandle !== handle) {
        return;
      }

      if (this.loop || this.#currentIndex < this.#tracks.length - 1) {
        this.next();
      } else {
        this.#currentHandle = undefined;
      }
    });

    return handle;
  }

  pause(time?: number): void {
    this.#currentHandle?.pause(time);
  }

  stop(time?: number): void {
    this.#currentHandle?.stop(time);
    this.#currentHandle = undefined;
  }

  next(options: PlaylistPlayOptions = {}): PlayHandle | undefined {
    const index = this.#resolveNextIndex();

    if (index < 0) {
      this.stop();

      return undefined;
    }

    return this.play(index, options);
  }

  previous(options: PlaylistPlayOptions = {}): PlayHandle | undefined {
    if (this.#tracks.length === 0) {
      this.stop();

      return undefined;
    }

    const index =
      this.#currentIndex <= 0 ? (this.loop ? this.#tracks.length - 1 : -1) : this.#currentIndex - 1;

    if (index < 0) {
      this.stop();

      return undefined;
    }

    return this.play(index, options);
  }

  seek(time: number): void {
    this.#currentHandle?.seek(time);
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.#currentHandle?.dispose();
    this.#currentHandle = undefined;
    this.#currentIndex = -1;
  }

  #resolveNextIndex(): number {
    if (this.#tracks.length === 0) {
      return -1;
    }

    if (this.shuffle) {
      return this.#pickWeightedRandomIndex();
    }

    if (this.#currentIndex < 0) {
      return 0;
    }

    const nextIndex = this.#currentIndex + 1;

    if (nextIndex < this.#tracks.length) {
      return nextIndex;
    }

    return this.loop ? 0 : -1;
  }

  #pickWeightedRandomIndex(): number {
    let total = 0;

    for (const track of this.#tracks) {
      total += Math.max(0, track.weight ?? 1);
    }

    if (total <= 0) {
      return Math.floor(Math.random() * this.#tracks.length);
    }

    let cursor = Math.random() * total;

    for (let i = 0; i < this.#tracks.length; i++) {
      cursor -= Math.max(0, this.#tracks[i]?.weight ?? 1);

      if (cursor <= 0) {
        return i;
      }
    }

    return this.#tracks.length - 1;
  }
}

function normalizeTrack(track: PlayerBlueprint | PlaylistTrack): PlaylistTrack {
  if ("player" in track) {
    return track;
  }

  return { player: track };
}
