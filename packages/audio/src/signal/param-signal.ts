import type { AudioContextLike } from "../context/context.ts";
import type { AudioDestination, AudioUnit, RunState } from "../unit.ts";
import type { Param, ParamUnit } from "./param.ts";

import { connectTo, createConstantSourceNode } from "../native.ts";
import { AudioUnitBase } from "../unit.ts";
import { createParam } from "./param.ts";

export type AudioSignalOptions<TUnit extends ParamUnit = "normalRange"> = {
  readonly autoStart?: boolean;
  readonly unit?: TUnit;
  readonly value?: number;
};

export interface SyncedSignalTransport {
  readonly bpm: number;
  syncSignal(signal: AudioSignal<ParamUnit>, ratio?: number): this;
  unsyncSignal(signal: AudioSignal<ParamUnit>): this;
}

export type SyncedSignalOptions<TUnit extends ParamUnit = "normalRange"> =
  AudioSignalOptions<TUnit> & {
    /**
     * Signal value per BPM. Defaults to the initial value divided by the transport BPM.
     */
    readonly ratio?: number;
    readonly sync?: boolean;
    readonly transport: SyncedSignalTransport;
  };

/**
 * Constant-source signal with a unit-aware offset param. Connect it to params or nodes.
 */
export class AudioSignal<TUnit extends ParamUnit = "normalRange">
  extends AudioUnitBase
  implements AudioUnit
{
  readonly node: ConstantSourceNode;
  readonly offset: Param<TUnit>;
  readonly unit: TUnit;
  #state: RunState = "stopped";
  #started = false;

  constructor(
    context: AudioContextLike,
    unit: TUnit,
    options: Omit<AudioSignalOptions<TUnit>, "unit"> = {},
  ) {
    super(context);
    this.unit = unit;
    this.node = this.nodes.addSource(createConstantSourceNode(this.native));
    this.offset = createParam(this.node.offset, unit, () => this.now());
    this.offset.setValueAtTime(options.value ?? 0, this.now());

    if (options.autoStart !== false) {
      this.start();
    }
  }

  get output(): ConstantSourceNode {
    return this.node;
  }

  get state(): RunState {
    return this.#state;
  }

  get value(): number {
    return this.offset.getValueAtTime(this.now());
  }

  connect<TDestination extends AudioDestination>(destination: TDestination): TDestination {
    return connectTo(this.node, destination);
  }

  disconnect(): void {
    this.node.disconnect();
  }

  setValueAtTime(value: number, time: number = this.now()): void {
    this.offset.setValueAtTime(value, time);
  }

  /**
   * Starts the source. A constant source starts once, so later calls are ignored.
   */
  start(time: number = this.now()): void {
    if (this.#started) {
      return;
    }

    this.#started = true;
    this.#state = "started";
    this.node.start(time);
  }

  /**
   * Schedules the stop. Calling it again reschedules the stop.
   */
  stop(time: number = this.now()): void {
    if (!this.#started) {
      return;
    }

    this.#state = "stopped";
    this.node.stop(time);
  }

  protected override teardown(): void {
    this.#state = "stopped";
  }
}

/**
 * Signal whose value follows the transport tempo: `value = ratio × bpm`.
 */
export class SyncedSignal<TUnit extends ParamUnit = "normalRange"> extends AudioSignal<TUnit> {
  readonly transport: SyncedSignalTransport;
  #ratio: number;
  #synced = false;

  constructor(
    context: AudioContextLike,
    unit: TUnit,
    options: Omit<SyncedSignalOptions<TUnit>, "unit">,
  ) {
    super(context, unit, options);
    this.transport = options.transport;
    this.#ratio = this.#resolveRatio(options.ratio);

    if (options.sync !== false) {
      this.sync(this.#ratio);
    }
  }

  get ratio(): number {
    return this.#ratio;
  }

  get synced(): boolean {
    return this.#synced;
  }

  /**
   * Re-applies the ratio after a tempo change.
   */
  refresh(): void {
    if (this.#synced) {
      this.transport.syncSignal(this, this.#ratio);
    }
  }

  sync(ratio?: number): void {
    this.#ratio = this.#resolveRatio(ratio ?? this.#ratio);
    this.transport.syncSignal(this, this.#ratio);
    this.#synced = true;
  }

  unsync(): void {
    this.transport.unsyncSignal(this);
    this.#synced = false;
  }

  protected override teardown(): void {
    if (this.#synced) {
      this.unsync();
    }

    super.teardown();
  }

  #resolveRatio(ratio: number | undefined): number {
    if (ratio !== undefined && Number.isFinite(ratio)) {
      return ratio;
    }

    return this.transport.bpm === 0 ? 0 : this.value / this.transport.bpm;
  }
}

/**
 * Creates an `AudioSignal`: a constant source whose value is expressed in `options.unit`
 * (`normalRange` by default).
 */
export function createAudioSignal(
  context: AudioContextLike,
  options?: AudioSignalOptions<"normalRange">,
): AudioSignal;
export function createAudioSignal<TUnit extends ParamUnit>(
  context: AudioContextLike,
  options: AudioSignalOptions<TUnit> & { readonly unit: TUnit },
): AudioSignal<TUnit>;
export function createAudioSignal(
  context: AudioContextLike,
  options: AudioSignalOptions<ParamUnit> = {},
): AudioSignal<ParamUnit> {
  return new AudioSignal(context, options.unit ?? "normalRange", options);
}

/**
 * Creates a `SyncedSignal` whose value follows the tempo of `options.transport`.
 */
export function createSyncedSignal(
  context: AudioContextLike,
  options: SyncedSignalOptions<"normalRange">,
): SyncedSignal;
export function createSyncedSignal<TUnit extends ParamUnit>(
  context: AudioContextLike,
  options: SyncedSignalOptions<TUnit> & { readonly unit: TUnit },
): SyncedSignal<TUnit>;
export function createSyncedSignal(
  context: AudioContextLike,
  options: SyncedSignalOptions<ParamUnit>,
): SyncedSignal<ParamUnit> {
  return new SyncedSignal(context, options.unit ?? "normalRange", options);
}
