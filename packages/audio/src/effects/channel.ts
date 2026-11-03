import type { AudioContextLike } from "../context/context.ts";
import type { CrossFadeOptions } from "../graph/blueprint.ts";
import type { Param } from "../signal/param.ts";
import type { AudioDestination, AudioUnit } from "../unit.ts";

import {
  connectTo,
  createChannelMergerNode,
  createChannelSplitterNode,
  createGainNode,
  createStereoPannerNode,
} from "../native.ts";
import { createParam, dbToGain } from "../signal/param.ts";
import { AudioNodeUnit, AudioUnitBase } from "../unit.ts";
import { clampNormal } from "../validation.ts";

export type VolumeOptions = {
  readonly muted?: boolean;
  /**
   * Level in decibels.
   */
  readonly volume?: number;
};

export type PanVolumeOptions = VolumeOptions & {
  readonly channelCount?: number;
  /**
   * Stereo position in [-1, 1].
   */
  readonly pan?: number;
};

export type SoloOptions = {
  readonly solo?: boolean;
};

export type ChannelOptions = PanVolumeOptions & SoloOptions;

export type StereoWidenerOptions = {
  /**
   * Width in [0, 1]: 0 is mono, 0.5 is unchanged, 1 is only the side signal.
   */
  readonly width?: number;
};

/**
 * Gain stage controlled in decibels, with mute that remembers the level.
 */
export class Volume extends AudioNodeUnit {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly volume: Param<"decibels">;
  #muted: boolean;
  #level: number;

  constructor(context: AudioContextLike, options: VolumeOptions = {}) {
    super(context);
    this.#muted = options.muted === true;
    this.#level = options.volume ?? 0;
    this.input = this.createGain(this.#muted ? 0 : dbToGain(this.#level));
    this.output = this.input;
    this.volume = createParam(this.input.gain, "decibels", () => this.now());
  }

  get muted(): boolean {
    return this.#muted;
  }

  mute(time: number = this.now()): void {
    if (this.#muted) {
      return;
    }

    this.#level = this.volume.getValueAtTime(time);
    this.#muted = true;
    this.input.gain.setValueAtTime(0, time);
  }

  unmute(time: number = this.now()): void {
    if (!this.#muted) {
      return;
    }

    this.#muted = false;
    this.input.gain.setValueAtTime(dbToGain(this.#level), time);
  }

  setVolume(volume: number, time: number = this.now()): void {
    this.#level = volume;

    if (!this.#muted) {
      this.input.gain.setValueAtTime(dbToGain(volume), time);
    }
  }
}

/**
 * Stereo panner followed by a volume stage.
 */
export class PanVolume extends AudioNodeUnit {
  readonly input: StereoPannerNode;
  readonly pan: Param<"normalRange">;
  readonly #volume: Volume;

  constructor(context: AudioContextLike, options: PanVolumeOptions = {}) {
    super(context);
    this.input = this.nodes.add(
      createStereoPannerNode(this.native, {
        channelCount: options.channelCount,
        pan: clampPan(options.pan ?? 0),
      }),
    );
    this.#volume = new Volume(context, options);
    this.pan = createParam(this.input.pan, "normalRange", () => this.now());
    this.input.connect(this.#volume.input);
  }

  get output(): GainNode {
    return this.#volume.output;
  }

  get muted(): boolean {
    return this.#volume.muted;
  }

  get volume(): Param<"decibels"> {
    return this.#volume.volume;
  }

  mute(time?: number): void {
    this.#volume.mute(time);
  }

  unmute(time?: number): void {
    this.#volume.unmute(time);
  }

  setPan(pan: number, time: number = this.now()): void {
    this.input.pan.setValueAtTime(clampPan(pan), time);
  }

  setVolume(volume: number, time?: number): void {
    this.#volume.setVolume(volume, time);
  }

  protected override teardown(): void {
    this.#volume.dispose();
  }
}

/**
 * Gate that silences itself while another gate in the same context is soloed.
 */
export class SoloGate extends AudioNodeUnit {
  static readonly #gates = new WeakMap<BaseAudioContext, Set<SoloGate>>();

  readonly input: GainNode;
  readonly output: GainNode;
  #solo: boolean;

  constructor(context: AudioContextLike, options: SoloOptions = {}) {
    super(context);
    this.input = this.createGain();
    this.output = this.input;
    this.#solo = options.solo === true;
    let gates = SoloGate.#gates.get(this.native);

    if (gates === undefined) {
      gates = new Set();
      SoloGate.#gates.set(this.native, gates);
    }

    gates.add(this);
    SoloGate.#update(this.native, this.now());
  }

  get solo(): boolean {
    return this.#solo;
  }

  setSolo(solo: boolean, time: number = this.now()): void {
    if (this.disposed || this.#solo === solo) {
      return;
    }

    this.#solo = solo;
    SoloGate.#update(this.native, time);
  }

  toggleSolo(time?: number): void {
    this.setSolo(!this.#solo, time);
  }

  protected override teardown(): void {
    SoloGate.#gates.get(this.native)?.delete(this);
    SoloGate.#update(this.native, this.now());
  }

  static #update(native: BaseAudioContext, time: number): void {
    const gates = SoloGate.#gates.get(native);

    if (gates === undefined) {
      return;
    }

    const anySolo = [...gates].some((gate) => gate.#solo);

    for (const gate of gates) {
      gate.input.gain.setValueAtTime(!anySolo || gate.#solo ? 1 : 0, time);
    }
  }
}

/**
 * Channel strip that runs its input through a `SoloGate` and then a `PanVolume`. Channels on the
 * same context exchange audio over named buses with `send()` and `receive()`.
 */
export class Channel extends AudioNodeUnit {
  static readonly #buses = new WeakMap<BaseAudioContext, Map<string, GainNode>>();

  readonly panVolume: PanVolume;
  readonly soloGate: SoloGate;
  readonly #received = new Set<GainNode>();

  constructor(context: AudioContextLike, options: ChannelOptions = {}) {
    super(context);
    this.soloGate = new SoloGate(context, options);
    this.panVolume = new PanVolume(context, options);
    this.soloGate.connect(this.panVolume.input);
  }

  get input(): GainNode {
    return this.soloGate.input;
  }

  get output(): GainNode {
    return this.panVolume.output;
  }

  get muted(): boolean {
    return this.soloGate.input.gain.value === 0 || this.panVolume.muted;
  }

  get pan(): Param<"normalRange"> {
    return this.panVolume.pan;
  }

  get solo(): boolean {
    return this.soloGate.solo;
  }

  get volume(): Param<"decibels"> {
    return this.panVolume.volume;
  }

  mute(time?: number): void {
    this.panVolume.mute(time);
  }

  unmute(time?: number): void {
    this.panVolume.unmute(time);
  }

  setPan(pan: number, time?: number): void {
    this.panVolume.setPan(pan, time);
  }

  setSolo(solo: boolean, time?: number): void {
    this.soloGate.setSolo(solo, time);
  }

  setVolume(volume: number, time?: number): void {
    this.panVolume.setVolume(volume, time);
  }

  toggleSolo(time?: number): void {
    this.soloGate.toggleSolo(time);
  }

  /**
   * Feeds the named bus of this context into the channel input.
   */
  receive(name: string): this {
    const bus = Channel.#bus(this.native, name);
    bus.connect(this.input);
    this.#received.add(bus);

    return this;
  }

  /**
   * Sends the channel output to the named bus through a new gain set to `volume` decibels, and
   * returns that gain.
   */
  send(name: string, volume: number = 0): GainNode {
    const knob = this.nodes.add(createGainNode(this.native, { gain: dbToGain(volume) }));
    this.output.connect(knob);
    knob.connect(Channel.#bus(this.native, name));

    return knob;
  }

  protected override teardown(): void {
    for (const bus of this.#received) {
      bus.disconnect(this.input);
    }

    this.soloGate.dispose();
    this.panVolume.dispose();
  }

  static #bus(native: BaseAudioContext, name: string): GainNode {
    let buses = Channel.#buses.get(native);

    if (buses === undefined) {
      buses = new Map();
      Channel.#buses.set(native, buses);
    }

    let bus = buses.get(name);

    if (bus === undefined) {
      bus = createGainNode(native);
      buses.set(name, bus);
    }

    return bus;
  }
}

/**
 * Linear crossfade between inputs `a` and `b`: `a` is scaled by `1 - fade` and `b` by `fade`.
 */
export class CrossFade extends AudioUnitBase implements AudioUnit {
  readonly a: GainNode;
  readonly b: GainNode;
  readonly output: GainNode;
  #fade: number;

  constructor(context: AudioContextLike, options: CrossFadeOptions = {}) {
    super(context);
    this.#fade = clampNormal(options.fade ?? 0.5, "fade");
    this.a = this.createGain(1 - this.#fade);
    this.b = this.createGain(this.#fade);
    this.output = this.createGain();
    this.a.connect(this.output);
    this.b.connect(this.output);
  }

  get fade(): number {
    return this.#fade;
  }

  connect<TDestination extends AudioDestination>(destination: TDestination): TDestination {
    return connectTo(this.output, destination);
  }

  disconnect(): void {
    this.output.disconnect();
  }

  setFade(fade: number, time: number = this.now()): void {
    this.#fade = clampNormal(fade, "fade");
    this.a.gain.setValueAtTime(1 - this.#fade, time);
    this.b.gain.setValueAtTime(this.#fade, time);
  }
}

/**
 * Copies a mono input to both channels of a stereo output.
 */
export class MonoToStereo extends AudioNodeUnit {
  readonly input: GainNode;
  readonly output: ChannelMergerNode;

  constructor(context: AudioContextLike) {
    super(context);
    this.input = this.createGain();
    this.output = this.nodes.add(createChannelMergerNode(this.native, { numberOfInputs: 2 }));
    this.input.connect(this.output, 0, 0);
    this.input.connect(this.output, 0, 1);
  }
}

/**
 * Splits a stereo input into mid `(L + R) / √2` and side `(L - R) / √2` outputs.
 */
export class MidSideSplit extends AudioUnitBase {
  readonly input: ChannelSplitterNode;
  readonly mid: GainNode;
  readonly side: GainNode;

  constructor(context: AudioContextLike) {
    super(context);
    this.input = this.nodes.add(createChannelSplitterNode(this.native, { numberOfOutputs: 2 }));
    this.mid = this.createGain(Math.SQRT1_2);
    this.side = this.createGain(Math.SQRT1_2);
    const invert = this.createGain(-1);
    this.input.connect(this.mid, 0);
    this.input.connect(this.mid, 1);
    this.input.connect(this.side, 0);
    this.input.connect(invert, 1);
    invert.connect(this.side);
  }
}

/**
 * Recombines mid and side inputs into a stereo output.
 */
export class MidSideMerge extends AudioUnitBase {
  readonly mid: GainNode;
  readonly side: GainNode;
  readonly output: ChannelMergerNode;

  constructor(context: AudioContextLike) {
    super(context);
    this.mid = this.createGain();
    this.side = this.createGain();
    this.output = this.nodes.add(createChannelMergerNode(this.native, { numberOfInputs: 2 }));
    const left = this.createGain(Math.SQRT1_2);
    const right = this.createGain(Math.SQRT1_2);
    const invert = this.createGain(-1);
    this.mid.connect(left);
    this.side.connect(left);
    this.mid.connect(right);
    this.side.connect(invert);
    invert.connect(right);
    left.connect(this.output, 0, 0);
    right.connect(this.output, 0, 1);
  }
}

/**
 * Mid/side stereo width control.
 */
export class StereoWidener extends AudioNodeUnit {
  readonly #split: MidSideSplit;
  readonly #merge: MidSideMerge;
  readonly #midGain: GainNode;
  readonly #sideGain: GainNode;
  #width: number;

  constructor(context: AudioContextLike, options: StereoWidenerOptions = {}) {
    super(context);
    this.#split = new MidSideSplit(context);
    this.#merge = new MidSideMerge(context);
    this.#width = clampNormal(options.width ?? 0.5, "width");
    this.#midGain = this.createGain(2 * (1 - this.#width));
    this.#sideGain = this.createGain(2 * this.#width);
    this.#split.mid.connect(this.#midGain);
    this.#split.side.connect(this.#sideGain);
    this.#midGain.connect(this.#merge.mid);
    this.#sideGain.connect(this.#merge.side);
  }

  get input(): ChannelSplitterNode {
    return this.#split.input;
  }

  get output(): ChannelMergerNode {
    return this.#merge.output;
  }

  get width(): number {
    return this.#width;
  }

  setWidth(width: number, time: number = this.now()): void {
    this.#width = clampNormal(width, "width");
    this.#midGain.gain.setValueAtTime(2 * (1 - this.#width), time);
    this.#sideGain.gain.setValueAtTime(2 * this.#width, time);
  }

  protected override teardown(): void {
    this.#split.dispose();
    this.#merge.dispose();
  }
}

function clampPan(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(-1, value));
}
