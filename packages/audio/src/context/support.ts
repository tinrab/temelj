import { isFunction, isNumber } from "@temelj/value";

import type { AudioContextLike } from "./context.ts";

import {
  getNativeAudioContext,
  isAudioContextSupported,
  isOfflineAudioContextSupported,
} from "./context.ts";
import {
  isAudioContextSinkSupported,
  isAudioDeviceChangeSupported,
  isAudioOutputSelectionSupported,
  isMediaDeviceEnumerationSupported,
  isMediaStreamSupported,
  isMediaSupportedConstraintsSupported,
} from "./devices.ts";
import { isMediaRecorderSupported } from "./recorder.ts";

export type AudioContextCapabilities = {
  readonly audioContext: boolean;
  readonly audioWorklet: boolean;
  readonly decodeAudioData: boolean;
  readonly mediaDeviceChangeEvents: boolean;
  readonly mediaDevices: boolean;
  readonly mediaDeviceEnumeration: boolean;
  readonly mediaRecorder: boolean;
  readonly mediaSupportedConstraints: boolean;
  readonly mediaElementSource: boolean;
  readonly mediaStreamDestination: boolean;
  readonly mediaStreamSource: boolean;
  readonly mediaStreamTrackSource: boolean;
  readonly outputDeviceSelection: boolean;
  readonly outputSink: boolean;
  readonly offlineAudioContext: boolean;
};

export type AudioContextLatency = {
  readonly baseLatency: number | undefined;
  readonly outputLatency: number | undefined;
  readonly totalLatency: number | undefined;
};

/**
 * Reports which Web Audio and media APIs the runtime supports. Pass `context` to check the methods
 * that live on it; without one, `decodeAudioData` and the media source and destination entries are
 * `false`.
 */
export function getAudioContextCapabilities(context?: AudioContextLike): AudioContextCapabilities {
  const nativeContext = context === undefined ? undefined : getNativeAudioContext(context);

  return {
    audioContext: isAudioContextSupported(),
    audioWorklet: isAudioWorkletSupported(context),
    decodeAudioData: nativeContext?.decodeAudioData instanceof Function,
    mediaDeviceChangeEvents: isAudioDeviceChangeSupported(),
    mediaDevices: isMediaStreamSupported(),
    mediaDeviceEnumeration: isMediaDeviceEnumerationSupported(),
    mediaRecorder: isMediaRecorderSupported(),
    mediaSupportedConstraints: isMediaSupportedConstraintsSupported(),
    mediaElementSource:
      nativeContext !== undefined &&
      "createMediaElementSource" in nativeContext &&
      isFunction(nativeContext.createMediaElementSource),
    mediaStreamDestination:
      nativeContext !== undefined &&
      "createMediaStreamDestination" in nativeContext &&
      isFunction(nativeContext.createMediaStreamDestination),
    mediaStreamSource:
      nativeContext !== undefined &&
      "createMediaStreamSource" in nativeContext &&
      isFunction(nativeContext.createMediaStreamSource),
    mediaStreamTrackSource: nativeContext?.createMediaStreamTrackSource instanceof Function,
    outputDeviceSelection: isAudioOutputSelectionSupported(),
    outputSink: isAudioContextSinkSupported(context),
    offlineAudioContext: isOfflineAudioContextSupported(),
  };
}

/**
 * Returns whether audio worklets are available, on `context` when given, otherwise in the runtime.
 */
export function isAudioWorkletSupported(context?: AudioContextLike): boolean {
  if (context !== undefined) {
    // SAFETY: `audioWorklet` is absent outside secure contexts (it is `[SecureContext]` in the spec); it is checked before use.
    const nativeContext = getNativeAudioContext(context) as BaseAudioContext & {
      readonly audioWorklet?: AudioWorklet;
    };

    return nativeContext.audioWorklet?.addModule instanceof Function;
  }

  return isFunction(globalThis.AudioWorkletNode);
}

/**
 * Returns the base and output latency of `context` in seconds, and their sum. Fields the runtime
 * does not report are `undefined`.
 */
export function getAudioContextLatency(context: AudioContextLike): AudioContextLatency {
  // SAFETY: latency fields exist only on `AudioContext`, not on offline contexts; they are validated before use.
  const nativeContext = getNativeAudioContext(context) as BaseAudioContext & {
    readonly baseLatency?: number;
    readonly outputLatency?: number;
  };

  const baseLatency = getFiniteLatency(nativeContext.baseLatency);
  const outputLatency = getFiniteLatency(nativeContext.outputLatency);

  return {
    baseLatency,
    outputLatency,
    totalLatency:
      isNumber(baseLatency) && isNumber(outputLatency) ? baseLatency + outputLatency : undefined,
  };
}

/**
 * Returns the context time and performance time of the audio currently reaching the speakers, or
 * `undefined` when the runtime cannot report it.
 */
export function getAudioContextOutputTimestamp(
  context: AudioContextLike,
): AudioTimestamp | undefined {
  // SAFETY: `getOutputTimestamp` exists only on `AudioContext`, not on offline contexts; it is checked before use.
  const nativeContext = getNativeAudioContext(context) as BaseAudioContext & {
    getOutputTimestamp?: () => AudioTimestamp;
  };

  if (!isFunction(nativeContext.getOutputTimestamp)) {
    return undefined;
  }

  return nativeContext.getOutputTimestamp();
}

function getFiniteLatency(value: number | undefined): number | undefined {
  return isNumber(value) && Number.isFinite(value) && value >= 0 ? value : undefined;
}
