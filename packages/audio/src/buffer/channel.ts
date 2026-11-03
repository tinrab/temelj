import { isNumber } from "@temelj/value";

import { floorNonNegative, floorPositive, snapToFrame } from "../validation.ts";

export type AudioBufferChannelData = Float32Array | readonly number[];

export type CreateAudioBufferOptions = {
  readonly channels?: readonly AudioBufferChannelData[];
  readonly duration?: number;
  readonly length?: number;
  readonly numberOfChannels?: number;
  readonly sampleRate: number;
};

export function copyChannelsToAudioBuffer(
  buffer: AudioBuffer,
  channels: readonly AudioBufferChannelData[],
): void {
  const limit = Math.min(buffer.numberOfChannels, channels.length);

  for (let channel = 0; channel < limit; channel++) {
    const data = channels[channel];

    if (data) {
      buffer.copyToChannel(Float32Array.from(data), channel);
    }
  }
}

export function resampleAudioBufferChannel(
  source: Float32Array,
  targetLength: number,
): Float32Array<ArrayBuffer> {
  const target = new Float32Array(targetLength);

  if (targetLength === 0 || source.length === 0) {
    return target;
  }

  if (source.length === 1 || targetLength === 1) {
    target.fill(source[0] ?? 0);

    return target;
  }

  const ratio = (source.length - 1) / (targetLength - 1);

  for (let index = 0; index < targetLength; index++) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(source.length - 1, left + 1);
    const amount = position - left;
    target[index] = (source[left] ?? 0) * (1 - amount) + (source[right] ?? 0) * amount;
  }

  return target;
}

export function getAudioBufferLength(options: {
  readonly duration?: number;
  readonly fallback: number | undefined;
  readonly length?: number;
  readonly sampleRate: number;
}): number {
  if (isNumber(options.length)) {
    return floorNonNegative(options.length, "AudioBuffer length");
  }

  if (isNumber(options.duration)) {
    return floorNonNegative(
      snapToFrame(options.duration * options.sampleRate),
      "AudioBuffer length",
    );
  }

  return options.fallback ?? 1;
}

export function getChannelLength(channels?: readonly AudioBufferChannelData[]): number | undefined {
  if (!channels || channels.length === 0) {
    return undefined;
  }

  return channels.reduce((length, channel) => Math.max(length, channel.length), 0);
}

export function getNumberOfChannels(options: CreateAudioBufferOptions): number {
  if (isNumber(options.numberOfChannels)) {
    return floorPositive(options.numberOfChannels, "AudioBuffer channel count");
  }

  if (options.channels && options.channels.length > 0) {
    return options.channels.length;
  }

  return 1;
}

export function getStereoPanGains(
  numberOfChannels: number,
  pan: number,
): readonly [number, number] | [] {
  if (numberOfChannels !== 2) {
    return [];
  }

  const clamped = Math.min(1, Math.max(-1, pan));
  const angle = ((clamped + 1) * Math.PI) / 4;

  return [Math.cos(angle), Math.sin(angle)];
}
