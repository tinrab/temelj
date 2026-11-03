import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { asNative } from "../../tests/audio.ts";
import {
  GlobalMockAudioContext as MockAudioContext,
  installContextTestGlobals,
} from "../../tests/context.ts";
import {
  createAudioContext,
  getAudioContextCapabilities,
  getAudioContextLatency,
  getAudioContextOutputTimestamp,
  isAudioDeviceChangeSupported,
  isAudioContextSinkSupported,
  isAudioOutputSelectionSupported,
  isAudioWorkletSupported,
  isMediaDeviceEnumerationSupported,
  isMediaRecorderSupported,
  isMediaSupportedConstraintsSupported,
  isMediaStreamSupported,
} from "../mod.ts";

let restoreContextTestGlobals: () => void;

beforeEach(() => {
  restoreContextTestGlobals = installContextTestGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
  restoreContextTestGlobals();
});

describe("context support", () => {
  it("reports global and context-specific Web Audio capabilities", () => {
    const context = createAudioContext({ autoResume: false });

    expect(isMediaStreamSupported()).toBe(true);
    expect(isMediaDeviceEnumerationSupported()).toBe(true);
    expect(isMediaSupportedConstraintsSupported()).toBe(true);
    expect(isAudioDeviceChangeSupported()).toBe(true);
    expect(isAudioOutputSelectionSupported()).toBe(true);
    expect(isAudioWorkletSupported()).toBe(true);
    expect(isMediaRecorderSupported()).toBe(true);
    expect(isMediaRecorderSupported("audio/webm")).toBe(true);
    expect(isMediaRecorderSupported("audio/unsupported")).toBe(false);
    expect(isAudioContextSinkSupported(context)).toBe(true);
    expect(isAudioWorkletSupported(context)).toBe(true);
    expect(getAudioContextCapabilities(context)).toEqual({
      audioContext: true,
      audioWorklet: true,
      decodeAudioData: true,
      mediaDeviceChangeEvents: true,
      mediaDeviceEnumeration: true,
      mediaSupportedConstraints: true,
      mediaDevices: true,
      mediaRecorder: true,
      mediaElementSource: true,
      mediaStreamDestination: true,
      mediaStreamSource: true,
      mediaStreamTrackSource: true,
      outputDeviceSelection: true,
      outputSink: true,
      offlineAudioContext: true,
    });
  });

  it("reports unsupported optional capabilities without a context", () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("OfflineAudioContext", undefined);
    vi.stubGlobal("AudioWorkletNode", undefined);
    vi.stubGlobal("MediaRecorder", undefined);
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {},
    });

    expect(getAudioContextCapabilities()).toEqual({
      audioContext: false,
      audioWorklet: false,
      decodeAudioData: false,
      mediaDeviceChangeEvents: false,
      mediaDeviceEnumeration: false,
      mediaSupportedConstraints: false,
      mediaDevices: false,
      mediaRecorder: false,
      mediaElementSource: false,
      mediaStreamDestination: false,
      mediaStreamSource: false,
      mediaStreamTrackSource: false,
      outputDeviceSelection: false,
      outputSink: false,
      offlineAudioContext: false,
    });
  });

  it("reads latency and output timestamp data when available", () => {
    const native = new MockAudioContext();
    native.currentTime = 4;

    expect(getAudioContextLatency(asNative<AudioContext>(native))).toEqual({
      baseLatency: 0.01,
      outputLatency: 0.02,
      totalLatency: 0.03,
    });
    expect(getAudioContextOutputTimestamp(asNative<AudioContext>(native))).toEqual({
      contextTime: 4,
      performanceTime: 123,
    });
    expect(native.getOutputTimestamp.mock.calls).toHaveLength(1);
  });

  it("normalizes unsupported latency and output timestamp data", () => {
    const native = asNative<BaseAudioContext>({
      currentTime: 0,
      destination: {},
      state: "running",
      baseLatency: -1,
      outputLatency: Number.POSITIVE_INFINITY,
    });

    expect(getAudioContextLatency(native)).toEqual({
      baseLatency: undefined,
      outputLatency: undefined,
      totalLatency: undefined,
    });
    expect(getAudioContextOutputTimestamp(native)).toBeUndefined();
  });
});
