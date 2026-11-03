import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { asNative, asMock } from "../../tests/audio.ts";
import {
  GlobalMockAudioContext as MockAudioContext,
  installContextTestGlobals,
  waitForAsyncDeviceInventory,
} from "../../tests/context.ts";
import { AudioUnsupportedError } from "../errors.ts";
import {
  createAudioInputConstraints,
  enumerateAudioDevices,
  enumerateAudioInputDevices,
  enumerateAudioOutputDevices,
  getAudioContextSinkId,
  getAudioDeviceInventory,
  getSupportedAudioConstraints,
  isAudioDeviceChangeSupported,
  isAudioContextSinkSupported,
  isAudioOutputSelectionSupported,
  isMediaDeviceEnumerationSupported,
  isMediaSupportedConstraintsSupported,
  onAudioDeviceChange,
  onAudioDeviceInventoryChange,
  requestAudioInputStream,
  selectAudioOutput,
  setAudioContextSinkId,
  stopMediaStream,
} from "../mod.ts";

let restoreContextTestGlobals: () => void;

beforeEach(() => {
  restoreContextTestGlobals = installContextTestGlobals();
});

afterEach(() => {
  restoreContextTestGlobals();
});

describe("audio devices", () => {
  it("gets and sets AudioContext output sink ids when supported", async () => {
    const native = new MockAudioContext();

    expect(getAudioContextSinkId(asNative<AudioContext>(native))).toBe("");

    await setAudioContextSinkId(asNative<AudioContext>(native), "speaker-2");

    expect(native.setSinkId.mock.calls).toEqual([["speaker-2"]]);
    expect(getAudioContextSinkId(asNative<AudioContext>(native))).toBe("speaker-2");

    await setAudioContextSinkId(asNative<AudioContext>(native), { type: "none" });

    expect(native.setSinkId.mock.calls.at(-1)).toEqual([{ type: "none" }]);
    expect(getAudioContextSinkId(asNative<AudioContext>(native))).toEqual({ type: "none" });
  });

  it("reports unsupported AudioContext output sink ids", async () => {
    const native = asNative<BaseAudioContext>({
      currentTime: 0,
      destination: {},
      state: "running",
      sinkId: { type: "unknown" },
    });

    expect(isAudioContextSinkSupported(native)).toBe(false);
    expect(getAudioContextSinkId(native)).toBeUndefined();
    await expect(setAudioContextSinkId(native, "speaker-2")).rejects.toThrow(AudioUnsupportedError);
  });

  it("selects audio output devices when the browser API is available", async () => {
    const selected = await selectAudioOutput({ deviceId: "speaker-3" });

    expect(selected.deviceId).toBe("speaker-3");
  });

  it("enumerates and filters audio devices", async () => {
    const allAudioDevices = await enumerateAudioDevices();
    const inputDevices = await enumerateAudioInputDevices();
    const outputDevices = await enumerateAudioOutputDevices();

    expect(allAudioDevices.map((device) => device.deviceId)).toEqual(["mic-1", "speaker-1"]);
    expect(inputDevices.map((device) => device.deviceId)).toEqual(["mic-1"]);
    expect(outputDevices.map((device) => device.deviceId)).toEqual(["speaker-1"]);
  });

  it("summarizes audio devices from one enumeration", async () => {
    const inventory = await getAudioDeviceInventory();

    expect(inventory.devices.map((device) => device.deviceId)).toEqual(["mic-1", "speaker-1"]);
    expect(inventory.inputs.map((device) => device.deviceId)).toEqual(["mic-1"]);
    expect(inventory.outputs.map((device) => device.deviceId)).toEqual(["speaker-1"]);
  });

  it("creates audio input constraints from booleans, raw constraints, and device ids", () => {
    expect(createAudioInputConstraints()).toEqual({ audio: true });
    expect(createAudioInputConstraints(false)).toEqual({ audio: false });
    expect(createAudioInputConstraints({ echoCancellation: true })).toEqual({
      audio: { echoCancellation: true },
    });
    expect(createAudioInputConstraints({ deviceId: "mic-2" })).toEqual({
      audio: { deviceId: { exact: "mic-2" } },
    });
    expect(
      createAudioInputConstraints({
        constraints: { echoCancellation: false },
        deviceId: "mic-3",
      }),
    ).toEqual({
      audio: {
        deviceId: { exact: "mic-3" },
        echoCancellation: false,
      },
    });
    expect(createAudioInputConstraints({ deviceId: "mic-4", noiseSuppression: true })).toEqual({
      audio: {
        deviceId: { exact: "mic-4" },
        noiseSuppression: true,
      },
    });
  });

  it("reports supported audio constraints", () => {
    expect(getSupportedAudioConstraints()).toEqual({
      deviceId: true,
      echoCancellation: true,
      noiseSuppression: true,
    });
  });

  it("subscribes and unsubscribes from audio device change events", () => {
    const mediaDevices = asMock<
      MediaDevices & {
        addEventListener: {
          readonly mock: { readonly calls: Array<[string, EventListener]> };
        };
        removeEventListener: {
          readonly mock: { readonly calls: Array<[string, EventListener]> };
        };
      }
    >(globalThis.navigator.mediaDevices);

    const callback = vi.fn<(event: Event) => void>();

    const unsubscribe = onAudioDeviceChange(callback);
    const listener = mediaDevices.addEventListener.mock.calls.at(0)?.[1];

    expect(mediaDevices.addEventListener.mock.calls.at(0)?.[0]).toBe("devicechange");

    const event = new Event("devicechange");
    listener?.(event);

    expect(callback.mock.calls).toEqual([[event]]);

    unsubscribe();
    unsubscribe();

    expect(mediaDevices.removeEventListener.mock.calls).toEqual([["devicechange", listener]]);
  });

  it("unsubscribes audio device change listeners when an abort signal fires", () => {
    const mediaDevices = asMock<
      MediaDevices & {
        addEventListener: {
          readonly mock: { readonly calls: Array<[string, EventListener]> };
        };
        removeEventListener: {
          readonly mock: { readonly calls: Array<[string, EventListener]> };
        };
      }
    >(globalThis.navigator.mediaDevices);

    const callback = vi.fn<(event: Event) => void>();
    const controller = new AbortController();

    const unsubscribe = onAudioDeviceChange(callback, { signal: controller.signal });
    const listener = mediaDevices.addEventListener.mock.calls.at(0)?.[1];
    controller.abort();
    unsubscribe();

    expect(mediaDevices.removeEventListener.mock.calls).toEqual([["devicechange", listener]]);
  });

  it("watches audio device inventory changes", async () => {
    const mediaDevices = asMock<
      MediaDevices & {
        addEventListener: {
          readonly mock: { readonly calls: Array<[string, EventListener]> };
        };
        removeEventListener: {
          readonly mock: { readonly calls: Array<[string, EventListener]> };
        };
      }
    >(globalThis.navigator.mediaDevices);

    const callback =
      vi.fn<
        (inventory: Awaited<ReturnType<typeof getAudioDeviceInventory>>, event?: Event) => void
      >();

    const unsubscribe = onAudioDeviceInventoryChange(callback);
    const listener = mediaDevices.addEventListener.mock.calls.at(-1)?.[1];
    const event = new Event("devicechange");
    listener?.(event);
    await waitForAsyncDeviceInventory();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0].inputs.map((device) => device.deviceId)).toEqual(["mic-1"]);
    expect(callback.mock.calls[0]?.[0].outputs.map((device) => device.deviceId)).toEqual([
      "speaker-1",
    ]);
    expect(callback.mock.calls[0]?.[1]).toBe(event);

    unsubscribe();
    expect(mediaDevices.removeEventListener.mock.calls.at(-1)).toEqual(["devicechange", listener]);
  });

  it("can emit an initial audio device inventory and report watcher errors", async () => {
    const callback =
      vi.fn<
        (inventory: Awaited<ReturnType<typeof getAudioDeviceInventory>>, event?: Event) => void
      >();

    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Mirrors the onError contract, which receives any thrown value.
    const onError = vi.fn<(error: unknown) => void>();

    const unsubscribe = onAudioDeviceInventoryChange(callback, { initial: true, onError });
    await waitForAsyncDeviceInventory();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0].devices.map((device) => device.deviceId)).toEqual([
      "mic-1",
      "speaker-1",
    ]);
    expect(callback.mock.calls[0]?.[1]).toBeUndefined();
    expect(onError).not.toHaveBeenCalled();

    unsubscribe();
  });

  it("requests audio input streams and stops their tracks", async () => {
    const mediaDevices = asMock<
      MediaDevices & {
        getUserMedia: {
          mock: {
            calls: Array<[MediaStreamConstraints?]>;
          };
        };
      }
    >(globalThis.navigator.mediaDevices);

    const stream = await requestAudioInputStream({
      constraints: { echoCancellation: true },
      deviceId: "mic-1",
    });

    expect(mediaDevices.getUserMedia.mock.calls.at(-1)).toEqual([
      {
        audio: {
          deviceId: { exact: "mic-1" },
          echoCancellation: true,
        },
      },
    ]);

    const tracks = stream.getTracks();
    stopMediaStream(stream);

    for (const track of tracks) {
      const mockTrack = asMock<{
        readonly stop: { readonly mock: { readonly calls: unknown[] } };
      }>(track);

      expect(mockTrack.stop.mock.calls).toHaveLength(1);
    }
  });

  it("throws when audio device enumeration is unavailable", async () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        mediaDevices: {},
      },
    });

    expect(isMediaDeviceEnumerationSupported()).toBe(false);
    await expect(enumerateAudioDevices()).rejects.toThrow(AudioUnsupportedError);
  });

  it("throws when audio input stream requests are unavailable", async () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        mediaDevices: {},
      },
    });

    await expect(requestAudioInputStream()).rejects.toThrow(AudioUnsupportedError);
  });

  it("returns empty supported audio constraints when unavailable", () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        mediaDevices: {},
      },
    });

    expect(isMediaSupportedConstraintsSupported()).toBe(false);
    expect(getSupportedAudioConstraints()).toEqual({});
  });

  it("throws when audio device change events are unavailable", () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        mediaDevices: {},
      },
    });

    expect(isAudioDeviceChangeSupported()).toBe(false);
    expect(() => onAudioDeviceChange(() => undefined)).toThrow(AudioUnsupportedError);
  });

  it("throws when audio output device selection is unavailable", async () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        mediaDevices: {},
      },
    });

    expect(isAudioOutputSelectionSupported()).toBe(false);
    await expect(selectAudioOutput()).rejects.toThrow(AudioUnsupportedError);
  });
});
