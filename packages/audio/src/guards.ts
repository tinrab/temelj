import { isFunction, isObject } from "@temelj/value";

/**
 * Structural guards for Web Audio values.
 *
 * These check shape rather than `instanceof` so they work across realms and in runtimes where
 * the Web Audio constructors are not defined.
 */

/**
 * Returns whether `value` has the shape of an `AudioBuffer`.
 */
export function isAudioBufferValue(value: unknown): value is AudioBuffer {
  return (
    isObject(value) &&
    "duration" in value &&
    "length" in value &&
    "numberOfChannels" in value &&
    "sampleRate" in value &&
    "getChannelData" in value &&
    isFunction(value.getChannelData)
  );
}

/**
 * Returns whether `value` has the shape of an `AudioParam`.
 */
export function isAudioParamValue(value: unknown): value is AudioParam {
  return (
    isObject(value) &&
    "value" in value &&
    "setValueAtTime" in value &&
    isFunction(value.setValueAtTime)
  );
}
