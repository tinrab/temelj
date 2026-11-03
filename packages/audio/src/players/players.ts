import type { AudioSourceInput } from "../buffer/loading.ts";
import type { AudioContextLike } from "../context/context.ts";
import type { TimeExpression } from "../time/time.ts";
import type { RunState } from "../unit.ts";

import { AudioGraphError } from "../errors.ts";
import { OutputUnit } from "./playback.ts";
import { Player } from "./player.ts";

export type PlayersOptions = {
  readonly fadeIn?: TimeExpression;
  readonly fadeOut?: TimeExpression;
  readonly mute?: boolean;
  readonly volume?: number;
};

/**
 * Named players behind one shared output. Fade settings set on the bank apply to every player in
 * it.
 */
export class Players<TName extends string = string> extends OutputUnit {
  readonly #players = new Map<TName, Player>();
  #fadeIn: TimeExpression;
  #fadeOut: TimeExpression;

  constructor(
    context: AudioContextLike,
    buffers?: Readonly<Record<TName, AudioBuffer>>,
    options: PlayersOptions = {},
  ) {
    super(context, options);
    this.#fadeIn = options.fadeIn ?? 0;
    this.#fadeOut = options.fadeOut ?? 0;

    // SAFETY: `Object.entries` widens the keys of a `Record<TName, …>` to string.
    for (const [name, buffer] of Object.entries(buffers ?? {}) as [TName, AudioBuffer][]) {
      this.addBuffer(name, buffer);
    }
  }

  /**
   * Loads every source and creates the players.
   */
  static async load<TName extends string>(
    context: AudioContextLike,
    sources: Readonly<Record<TName, AudioSourceInput>>,
    options: PlayersOptions = {},
  ): Promise<Players<TName>> {
    const players = new Players<TName>(context, undefined, options);
    await Promise.all(
      // SAFETY: `Object.entries` widens the keys of a `Record<TName, …>` to string.
      (Object.entries(sources) as [TName, AudioSourceInput][]).map(([name, source]) =>
        players.addSource(name, source),
      ),
    );

    return players;
  }

  get fadeIn(): TimeExpression {
    return this.#fadeIn;
  }

  get fadeOut(): TimeExpression {
    return this.#fadeOut;
  }

  get names(): readonly TName[] {
    return [...this.#players.keys()];
  }

  get size(): number {
    return this.#players.size;
  }

  get state(): RunState {
    return [...this.#players.values()].some((player) => player.state === "started")
      ? "started"
      : "stopped";
  }

  /**
   * Adds `player` under `name`, replacing (and disconnecting) any player with that name.
   */
  add(name: TName, player: Player): this {
    this.#players.get(name)?.disconnect();
    player.setFadeIn(this.#fadeIn);
    player.setFadeOut(this.#fadeOut);
    player.connect(this.output);
    this.#players.set(name, player);

    return this;
  }

  addBuffer(name: TName, buffer: AudioBuffer): Player {
    const player = new Player(this.context, buffer);
    this.add(name, player);

    return player;
  }

  async addSource(name: TName, source: AudioSourceInput): Promise<Player> {
    const player = await Player.load(this.context, source);
    this.add(name, player);

    return player;
  }

  has(name: TName): boolean {
    return this.#players.has(name);
  }

  player(name: TName): Player {
    return this.#players.get(name) ?? AudioGraphError.missingResource("player", name);
  }

  remove(name: TName): Player | undefined {
    const player = this.#players.get(name);
    this.#players.delete(name);
    player?.dispose();

    return player;
  }

  setFadeIn(fadeIn: TimeExpression): void {
    this.#fadeIn = fadeIn;

    for (const player of this.#players.values()) {
      player.setFadeIn(fadeIn);
    }
  }

  setFadeOut(fadeOut: TimeExpression): void {
    this.#fadeOut = fadeOut;

    for (const player of this.#players.values()) {
      player.setFadeOut(fadeOut);
    }
  }

  stopAll(time?: TimeExpression): void {
    for (const player of this.#players.values()) {
      player.stop(time);
    }
  }

  protected override teardown(): void {
    for (const player of this.#players.values()) {
      player.dispose();
    }

    this.#players.clear();
  }
}
