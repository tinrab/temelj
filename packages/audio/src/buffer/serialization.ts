import { isFunction, isNumber } from "@temelj/value";

import { AudioRangeError, AudioUnsupportedError } from "../errors.ts";
import { requirePositive } from "../validation.ts";

export type AudioBufferToArrayOptions = {
  readonly channel?: number;
};

export type AudioBufferWavOptions = {
  readonly float?: boolean;
};

export type AudioBufferInfo = {
  readonly bitsPerSample: 32;
  readonly duration: number;
  readonly length: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
};

/**
 * Copies the samples of `buffer` into `Float32Array`s. Returns a single array when
 * `options.channel` is set or the buffer is mono, otherwise one array per channel.
 */
export function audioBufferToArray(
  buffer: AudioBuffer,
  options: AudioBufferToArrayOptions & { readonly channel: number },
): Float32Array;
export function audioBufferToArray(
  buffer: AudioBuffer,
  options?: AudioBufferToArrayOptions,
): Float32Array | Float32Array[];
export function audioBufferToArray(
  buffer: AudioBuffer,
  options: AudioBufferToArrayOptions = {},
): Float32Array | Float32Array[] {
  if (isNumber(options.channel)) {
    return Float32Array.from(getAudioBufferChannelData(buffer, options.channel));
  }

  if (buffer.numberOfChannels === 1) {
    return Float32Array.from(getAudioBufferChannelData(buffer, 0));
  }

  return Array.from({ length: buffer.numberOfChannels }, (_value, channel) =>
    Float32Array.from(getAudioBufferChannelData(buffer, channel)),
  );
}

/**
 * Copies the samples of `buffer` into one interleaved array (`L R L R …` for stereo).
 */
export function audioBufferToInterleavedArray(buffer: AudioBuffer): Float32Array<ArrayBuffer> {
  const data = new Float32Array(buffer.length * buffer.numberOfChannels);

  for (let frame = 0; frame < buffer.length; frame++) {
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      data[frame * buffer.numberOfChannels + channel] =
        getAudioBufferChannelData(buffer, channel)[frame] ?? 0;
    }
  }

  return data;
}

/**
 * Encodes `buffer` as a WAV file: 16-bit PCM by default, or 32-bit float with `options.float`.
 * Samples are clamped to -1 to 1 in both formats.
 */
export function audioBufferToWavArrayBuffer(
  buffer: AudioBuffer,
  options: AudioBufferWavOptions = {},
): ArrayBuffer {
  const isFloat = options.float === true;
  const bytesPerSample = isFloat ? 4 : 2;
  const dataLength = buffer.length * buffer.numberOfChannels * bytesPerSample;
  const wav = new ArrayBuffer(44 + dataLength);
  const view = new DataView(wav);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, isFloat ? 3 : 1, true);
  view.setUint16(22, buffer.numberOfChannels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * buffer.numberOfChannels * bytesPerSample, true);
  view.setUint16(32, buffer.numberOfChannels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataLength, true);
  writeWavSamples(view, 44, buffer, isFloat);

  return wav;
}

/**
 * Encodes `buffer` as a WAV `Blob` with the `audio/wav` type. See `audioBufferToWavArrayBuffer()`.
 *
 * @throws {AudioUnsupportedError} When `Blob` is not available.
 */
export function audioBufferToWavBlob(
  buffer: AudioBuffer,
  options: AudioBufferWavOptions = {},
): Blob {
  if (!isFunction(globalThis.Blob)) {
    AudioUnsupportedError.missingApi("Blob");
  }

  return new Blob([audioBufferToWavArrayBuffer(buffer, options)], {
    type: "audio/wav",
  });
}

/**
 * Returns the live sample array of one channel. Writes to it change `buffer`.
 *
 * @throws {AudioRangeError} When `channel` is out of range.
 */
export function getAudioBufferChannelData(buffer: AudioBuffer, channel: number): Float32Array {
  assertChannelIndex(buffer, channel);

  return buffer.getChannelData(channel);
}

/**
 * Returns the live sample array of every channel. Writes to them change `buffer`.
 */
export function getAudioBufferChannels(buffer: AudioBuffer): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_value, channel) =>
    getAudioBufferChannelData(buffer, channel),
  );
}

/**
 * Returns the duration in seconds of `length` frames at `sampleRate`.
 *
 * @throws {AudioRangeError} When `sampleRate` is not positive.
 */
export function getAudioBufferDuration(length: number, sampleRate: number): number {
  return length / requirePositive(sampleRate ?? 1, "sampleRate");
}

/**
 * Returns the format of `buffer` as a plain object. `bitsPerSample` is always 32, since Web Audio
 * stores samples as 32-bit floats.
 */
export function getAudioBufferInfo(buffer: AudioBuffer): AudioBufferInfo {
  return {
    bitsPerSample: 32,
    duration: buffer.duration,
    length: buffer.length,
    numberOfChannels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate,
  };
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index++) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function writeWavSamples(
  view: DataView,
  offset: number,
  buffer: AudioBuffer,
  float: boolean,
): void {
  let cursor = offset;

  for (let frame = 0; frame < buffer.length; frame++) {
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const sample = clampSample(getAudioBufferChannelData(buffer, channel)[frame] ?? 0);

      if (float) {
        view.setFloat32(cursor, sample, true);
        cursor += 4;
      } else {
        view.setInt16(cursor, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        cursor += 2;
      }
    }
  }
}

function clampSample(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(-1, Math.min(1, value));
}

function assertChannelIndex(buffer: AudioBuffer, channel: number): void {
  if (!Number.isInteger(channel) || channel < 0 || channel >= buffer.numberOfChannels) {
    AudioRangeError.outOfRange("channel", channel, 0, buffer.numberOfChannels - 1);
  }
}
