import { AudioRangeError } from "../errors.ts";
import { requireInteger, requireNonNegativeInteger, snapToFrame } from "../validation.ts";
import { getAudioBufferChannelData } from "./serialization.ts";

export function assertCompatibleAudioBuffer(
  buffer: AudioBuffer,
  expected: { readonly numberOfChannels: number; readonly sampleRate: number },
): void {
  if (buffer.sampleRate !== expected.sampleRate) {
    AudioRangeError.mismatch("AudioBuffer sample rate", expected.sampleRate, buffer.sampleRate);
  }

  if (buffer.numberOfChannels !== expected.numberOfChannels) {
    AudioRangeError.mismatch(
      "AudioBuffer channel count",
      expected.numberOfChannels,
      buffer.numberOfChannels,
    );
  }
}

export function assertStereoAudioBuffer(buffer: AudioBuffer, label: string): void {
  if (buffer.numberOfChannels !== 2) {
    AudioRangeError.mismatch(`${label} channel count`, 2, buffer.numberOfChannels);
  }
}

export function secondsToFrame(
  seconds: number,
  sampleRate: number,
  label = "AudioBuffer slice frame",
): number {
  return requireNonNegativeInteger(snapToFrame(seconds * sampleRate), label);
}

/**
 * Frame range `[start, end)` for an optional `start`/`end` in seconds, defaulting to the
 * whole buffer.
 */
export function getFrameRange(
  buffer: AudioBuffer,
  range: { readonly end?: number; readonly start?: number },
  name: string,
): readonly [start: number, end: number] {
  const start = secondsToFrame(range.start ?? 0, buffer.sampleRate);
  const end = secondsToFrame(range.end ?? buffer.duration, buffer.sampleRate);

  if (start > end) {
    AudioRangeError.invalidRange(name, start, end);
  }

  return [start, end];
}

export function secondsToSignedFrame(seconds: number, sampleRate: number): number {
  return requireInteger(snapToFrame(seconds * sampleRate), "AudioBuffer shift frame");
}

export function isSilentFrame(buffer: AudioBuffer, frame: number, threshold: number): boolean {
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    if (Math.abs(getAudioBufferChannelData(buffer, channel)[frame] ?? 0) > threshold) {
      return false;
    }
  }

  return true;
}
