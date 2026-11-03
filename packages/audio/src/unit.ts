import type { AudioContextLike } from "./context/context.ts";

import { getAudioContextImmediateTime, getNativeAudioContext } from "./context/context.ts";
import { connectTo, createGainNode, OwnedNodes } from "./native.ts";

export type AudioDestination = AudioNode | AudioParam;

/**
 * Shared contract for runtime audio objects that own native nodes.
 */
export interface AudioUnit {
  readonly disposed: boolean;
  connect<TDestination extends AudioDestination>(destination: TDestination): TDestination;
  disconnect(): void;
  dispose(): void;
}

export type RunState = "started" | "stopped";

export type PlaybackState = "paused" | "started" | "stopped";

export type FadeCurve = "exponential" | "linear";

/**
 * Lifecycle shared by runtime units: owns native nodes and disposes them once.
 */
export abstract class AudioUnitBase {
  readonly #context: AudioContextLike;
  readonly #native: BaseAudioContext;
  readonly #nodes = new OwnedNodes();
  #disposed = false;

  constructor(context: AudioContextLike) {
    this.#context = context;
    this.#native = getNativeAudioContext(context);
  }

  protected get context(): AudioContextLike {
    return this.#context;
  }

  protected get native(): BaseAudioContext {
    return this.#native;
  }

  /**
   * Nodes disconnected (and sources stopped) on dispose.
   */
  protected get nodes(): OwnedNodes {
    return this.#nodes;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.teardown();
    this.nodes.dispose(this.now());
  }

  /**
   * Current native time, the default for scheduled setters.
   */
  protected now(): number {
    return getAudioContextImmediateTime(this.context);
  }

  /**
   * Extra cleanup that runs once before the owned nodes are disconnected.
   */
  protected teardown(): void {}

  protected createGain(value = 1): GainNode {
    return this.nodes.add(createGainNode(this.native, { gain: value }));
  }
}

/**
 * Runtime unit with one input and one output node.
 */
export abstract class AudioNodeUnit extends AudioUnitBase implements AudioUnit {
  abstract readonly input: AudioNode;
  abstract readonly output: AudioNode;

  connect<TDestination extends AudioDestination>(destination: TDestination): TDestination {
    return connectTo(this.output, destination);
  }

  disconnect(): void {
    this.output.disconnect();
  }
}
