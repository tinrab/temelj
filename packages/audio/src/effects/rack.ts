import type { AudioContextLike } from "../context/context.ts";

import { AudioDisposedError } from "../errors.ts";
import { AudioNodeUnit } from "../unit.ts";

/**
 * Anything with an input and an output that can sit in a rack.
 */
export type RackEffect = {
  readonly input: AudioNode;
  readonly output: AudioNode;
};

type RackEntry = {
  readonly effect: RackEffect;
  readonly inlet: GainNode;
  readonly outlet: GainNode;
};

/**
 * Serial effect chain that can be reordered while running. Effects are not disposed by the
 * rack; their owners dispose them.
 */
export class EffectRack extends AudioNodeUnit {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #entries: RackEntry[] = [];

  constructor(context: AudioContextLike, effects: readonly RackEffect[] = []) {
    super(context);
    this.input = this.createGain();
    this.output = this.createGain();

    for (const effect of effects) {
      this.#insert(effect, this.#entries.length);
    }

    this.#reconnect();
  }

  get effects(): readonly RackEffect[] {
    return this.#entries.map((entry) => entry.effect);
  }

  /**
   * Inserts `effect` at `index` (default: the end). Adding an effect twice is ignored.
   */
  add(effect: RackEffect, index: number = this.#entries.length): void {
    this.#assertUsable();
    this.#insert(effect, index);
    this.#reconnect();
  }

  remove(effect: RackEffect): boolean {
    this.#assertUsable();
    const index = this.#entries.findIndex((entry) => entry.effect === effect);

    if (index === -1) {
      return false;
    }

    for (const entry of this.#entries.splice(index, 1)) {
      disconnectEntry(entry);
    }

    this.#reconnect();

    return true;
  }

  clear(): void {
    this.#assertUsable();

    for (const entry of this.#entries.splice(0)) {
      disconnectEntry(entry);
    }

    this.#reconnect();
  }

  protected override teardown(): void {
    for (const entry of this.#entries.splice(0)) {
      disconnectEntry(entry);
    }
  }

  #insert(effect: RackEffect, index: number): void {
    if (this.#entries.some((entry) => entry.effect === effect)) {
      return;
    }

    const inlet = this.createGain();
    const outlet = this.createGain();
    inlet.connect(effect.input);
    effect.output.connect(outlet);
    const position = Math.min(this.#entries.length, Math.max(0, Math.trunc(index)));
    this.#entries.splice(position, 0, { effect, inlet, outlet });
  }

  #reconnect(): void {
    this.input.disconnect();

    for (const entry of this.#entries) {
      entry.outlet.disconnect();
    }

    let previous: AudioNode = this.input;

    for (const entry of this.#entries) {
      previous.connect(entry.inlet);
      previous = entry.outlet;
    }

    previous.connect(this.output);
  }

  #assertUsable(): void {
    if (this.disposed) {
      AudioDisposedError.disposed("effect rack");
    }
  }
}

function disconnectEntry(entry: RackEntry): void {
  entry.inlet.disconnect();
  // Only the rack's own link: the effect may be connected elsewhere too.
  entry.effect.output.disconnect(entry.outlet);
  entry.outlet.disconnect();
}
