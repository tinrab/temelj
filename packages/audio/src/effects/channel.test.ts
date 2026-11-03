import { describe, expect, it } from "vitest";

import { asNative, createMockAudioContext, createMockFacade } from "../../tests/audio.ts";
import {
  Channel,
  CrossFade,
  MidSideMerge,
  MidSideSplit,
  MonoToStereo,
  PanVolume,
  SoloGate,
  StereoWidener,
  Volume,
} from "../mod.ts";

describe("Volume", () => {
  it("sets decibel volume and restores it after mute", () => {
    const context = createMockAudioContext(2);
    const volume = new Volume(context, { volume: -6 });
    const gain = context.createdGains[0]!;

    expect(gain.gain.value).toBeCloseTo(0.501187, 5);

    volume.mute(3);
    expect(volume.muted).toBe(true);
    expect(gain.gain.setValueAtTime.mock.calls.at(-1)).toEqual([0, 3]);

    volume.unmute(4);
    expect(volume.muted).toBe(false);
    expect(gain.gain.value).toBeCloseTo(0.501187, 5);
  });

  it("stores volume changes while muted and applies them on unmute", () => {
    const context = createMockAudioContext(2);
    const volume = new Volume(context, { muted: true, volume: -12 });
    const gain = context.createdGains[0]!;

    expect(gain.gain.value).toBe(0);
    volume.setVolume(-3, 3);
    expect(gain.gain.value).toBe(0);
    volume.unmute(4);
    expect(gain.gain.value).toBeCloseTo(0.707945, 5);
  });

  it("defaults automation times to the facade immediate time", () => {
    const native = createMockAudioContext(2);
    const volume = new Volume(createMockFacade(asNative<AudioContext>(native), 0.5));

    volume.mute();
    expect(native.createdGains[0]!.gain.setValueAtTime.mock.calls.at(-1)?.[1]).toBe(2);
  });

  it("disconnects its node once", () => {
    const context = createMockAudioContext();
    const volume = new Volume(context);

    volume.dispose();
    volume.dispose();
    expect(volume.disposed).toBe(true);
    expect(context.createdGains[0]!.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe("PanVolume", () => {
  it("clamps pan and routes the panner into the volume stage", () => {
    const context = createMockAudioContext(2);
    const panVolume = new PanVolume(context, { channelCount: 1, pan: 2, volume: -6 });
    const panner = context.createdPanners[0]!;

    expect(panner.channelCount).toBe(1);
    expect(panner.pan.value).toBe(1);
    expect(panner.connect).toHaveBeenCalledWith(panVolume.output);

    panVolume.setPan(-3, 5);
    expect(panner.pan.setValueAtTime.mock.calls.at(-1)).toEqual([-1, 5]);

    panVolume.dispose();
    expect(panner.disconnect).toHaveBeenCalledTimes(1);
    expect(context.createdGains[0]!.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe("SoloGate", () => {
  it("silences every other gate in the same context while one is soloed", () => {
    const context = createMockAudioContext(1);
    const drums = new SoloGate(context);
    const bass = new SoloGate(context);
    const [drumGain, bassGain] = context.createdGains;

    drums.setSolo(true, 2);
    expect(drumGain!.gain.value).toBe(1);
    expect(bassGain!.gain.value).toBe(0);

    drums.toggleSolo(3);
    expect(drums.solo).toBe(false);
    expect(bassGain!.gain.value).toBe(1);

    bass.setSolo(true);
    bass.dispose();
    expect(drumGain!.gain.value).toBe(1);
  });
});

describe("Channel", () => {
  it("routes solo, pan, and volume and exposes their controls", () => {
    const context = createMockAudioContext(2);
    const channel = new Channel(context, { pan: -0.25, volume: -12 });

    expect(channel.pan.getValueAtTime(2)).toBe(-0.25);
    expect(channel.volume.getValueAtTime(2)).toBe(-12);
    expect(channel.muted).toBe(false);

    channel.mute(3);
    expect(channel.muted).toBe(true);
    channel.unmute(4);
    channel.setSolo(true);
    expect(channel.solo).toBe(true);
  });

  it("sends to and receives from named buses of the same context", () => {
    const context = createMockAudioContext(2);
    const source = new Channel(context);
    const target = new Channel(context);

    const knob = source.send("reverb", -9);
    target.receive("reverb");

    const bus = context.createdGains.at(-1)!;
    expect(knob.gain.value).toBeCloseTo(0.354813, 5);
    expect(bus.connect).toHaveBeenCalledWith(target.input);

    target.dispose();
    source.dispose();
    expect(bus.disconnect).toHaveBeenCalledWith(target.input);
    expect(source.disposed).toBe(true);
  });
});

describe("CrossFade", () => {
  it("balances inputs a and b and validates the fade", () => {
    const context = createMockAudioContext();
    const crossFade = new CrossFade(context, { fade: 0.25 });

    expect(crossFade.a.gain.value).toBe(0.75);
    expect(crossFade.b.gain.value).toBe(0.25);

    crossFade.setFade(1, 3);
    expect(crossFade.fade).toBe(1);
    expect(crossFade.a.gain.value).toBe(0);
    expect(() => {
      crossFade.setFade(Number.NaN);
    }).toThrow(RangeError);
  });
});

describe("MonoToStereo", () => {
  it("routes the input into both merger channels", () => {
    const context = createMockAudioContext();
    const mono = new MonoToStereo(context);
    const input = context.createdGains[0]!;

    expect(input.connect.mock.calls).toEqual([
      [mono.output, 0, 0],
      [mono.output, 0, 1],
    ]);
  });
});

describe("mid/side", () => {
  it("splits into normalized mid and side and recombines them", () => {
    const context = createMockAudioContext();
    const split = new MidSideSplit(context);
    const merge = new MidSideMerge(context);
    const splitter = context.createdSplitters[0]!;

    expect(split.mid.gain.value).toBe(Math.SQRT1_2);
    expect(split.side.gain.value).toBe(Math.SQRT1_2);
    expect(splitter.connect).toHaveBeenCalledWith(split.mid, 0);
    expect(splitter.connect).toHaveBeenCalledWith(split.mid, 1);
    expect(context.createdMergers[0]).toBe(merge.output);

    const created = context.createdGains.length;
    split.dispose();
    merge.dispose();

    for (const gain of context.createdGains.slice(0, created)) {
      expect(gain.disconnect).toHaveBeenCalledTimes(1);
    }
  });

  it("widens by scaling mid and side", () => {
    const context = createMockAudioContext();
    const widener = new StereoWidener(context, { width: 0.75 });

    expect(widener.width).toBe(0.75);
    widener.setWidth(1, 4);
    expect(widener.width).toBe(1);
    expect(() => {
      widener.setWidth(Number.POSITIVE_INFINITY);
    }).toThrow(RangeError);

    widener.dispose();

    for (const gain of context.createdGains) {
      expect(gain.disconnect).toHaveBeenCalledTimes(1);
    }
  });
});
