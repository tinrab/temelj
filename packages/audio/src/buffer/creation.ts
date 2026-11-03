import { isNumber } from "@temelj/value";

import { AudioRangeError } from "../errors.ts";
import { floorPositive, requireFinite, requirePositive } from "../validation.ts";
import {
  copyChannelsToAudioBuffer,
  getAudioBufferLength,
  getChannelLength,
  getNumberOfChannels,
  getStereoPanGains,
  type AudioBufferChannelData,
  type CreateAudioBufferOptions,
} from "./channel.ts";
import { assertCompatibleAudioBuffer, secondsToFrame } from "./frames.ts";
import { getAudioBufferChannelData } from "./serialization.ts";

export type CreateAudioBufferFromInterleavedOptions = {
  readonly numberOfChannels: number;
  readonly sampleRate: number;
};

export type MixAudioBuffersOptions = {
  readonly gains?: readonly number[];
  readonly offsets?: readonly number[];
  readonly pans?: readonly number[];
};

/**
 * Allocates an `AudioBuffer`. The length is `options.length` frames, else `options.duration`
 * seconds, else the longest of `options.channels`, else 1 frame. Pass `context.sampleRate` to match
 * a context.
 *
 * @throws {AudioRangeError} When the length is below one frame, since Web Audio has no empty
 * buffers.
 */
export function createAudioBuffer(options: CreateAudioBufferOptions): AudioBuffer {
  const sampleRate = requirePositive(options.sampleRate, "sampleRate");
  const channelLength = getChannelLength(options.channels);

  const length = getAudioBufferLength({
    duration: options.duration,
    fallback: channelLength,
    length: options.length,
    sampleRate,
  });

  // Web Audio rejects empty buffers with a bare `NotSupportedError`; fail with a clear error.
  if (length < 1) {
    AudioRangeError.notPositive("AudioBuffer length", length);
  }

  const numberOfChannels = getNumberOfChannels(options);
  const buffer = new AudioBuffer({ length, numberOfChannels, sampleRate });

  if (options.channels) {
    copyChannelsToAudioBuffer(buffer, options.channels);
  }

  return buffer;
}

/**
 * Creates an `AudioBuffer` with one channel per entry in `channels`. Channels shorter than the
 * longest are padded with silence. The samples are copied.
 */
export function createAudioBufferFromChannels(
  channels: readonly AudioBufferChannelData[],
  options: Omit<CreateAudioBufferOptions, "channels" | "numberOfChannels">,
): AudioBuffer {
  return createAudioBuffer({ ...options, channels });
}

/**
 * Creates an `AudioBuffer` from interleaved samples (`L R L R …` for stereo).
 * `options.numberOfChannels` sets the interleave stride.
 *
 * @throws {AudioRangeError} When the sample count is not a multiple of the channel count.
 */
export function createAudioBufferFromInterleavedArray(
  data: AudioBufferChannelData,
  options: CreateAudioBufferFromInterleavedOptions,
): AudioBuffer {
  const numberOfChannels = floorPositive(options.numberOfChannels, "AudioBuffer channel count");

  if (data.length % numberOfChannels !== 0) {
    AudioRangeError.mismatch(
      "interleaved length modulo channel count",
      0,
      data.length % numberOfChannels,
    );
  }

  const length = data.length / numberOfChannels;
  const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));

  for (let frame = 0; frame < length; frame++) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      channels[channel]![frame] = data[frame * numberOfChannels + channel] ?? 0;
    }
  }

  return createAudioBufferFromChannels(channels, {
    sampleRate: options.sampleRate,
  });
}

/**
 * Returns a new `AudioBuffer` with the same format and a copy of every sample.
 */
export function copyAudioBuffer(source: AudioBuffer): AudioBuffer {
  const target = createAudioBuffer({
    length: source.length,
    numberOfChannels: source.numberOfChannels,
    sampleRate: source.sampleRate,
  });

  for (let channel = 0; channel < source.numberOfChannels; channel++) {
    target.copyToChannel(Float32Array.from(getAudioBufferChannelData(source, channel)), channel);
  }

  return target;
}

/**
 * Joins `sources` end to end into a new `AudioBuffer`.
 *
 * @throws {AudioRangeError} When `sources` is empty or the buffers differ in channel count or sample
 * rate.
 */
export function concatAudioBuffers(sources: readonly AudioBuffer[]): AudioBuffer {
  if (sources.length === 0) {
    AudioRangeError.empty("AudioBuffer list");
  }

  const [first] = sources;
  const sampleRate = first!.sampleRate;
  const numberOfChannels = first!.numberOfChannels;

  const length = sources.reduce((total, source) => {
    assertCompatibleAudioBuffer(source, { numberOfChannels, sampleRate });

    return total + source.length;
  }, 0);

  const target = createAudioBuffer({
    length,
    numberOfChannels,
    sampleRate,
  });

  let offset = 0;

  for (const source of sources) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      target.copyToChannel(
        Float32Array.from(getAudioBufferChannelData(source, channel)),
        channel,
        offset,
      );
    }

    offset += source.length;
  }

  return target;
}

/**
 * Sums `sources` into a new `AudioBuffer` long enough to hold every source. Per-source
 * `options.offsets` (seconds) and `options.gains` position and scale each input. For stereo output,
 * `options.pans` applies an equal-power pan from -1 (left) to 1 (right).
 *
 * @throws {AudioRangeError} When `sources` is empty or its buffers differ in channel count or
 * sample rate. Offsets must also fall on whole sample frames.
 */
export function mixAudioBuffers(
  sources: readonly AudioBuffer[],
  options: MixAudioBuffersOptions = {},
): AudioBuffer {
  if (sources.length === 0) {
    AudioRangeError.empty("AudioBuffer list");
  }

  const [first] = sources;
  const sampleRate = first!.sampleRate;
  const numberOfChannels = first!.numberOfChannels;

  const offsets = sources.map((_source, index) =>
    secondsToFrame(options.offsets?.[index] ?? 0, sampleRate, "AudioBuffer mix offset"),
  );

  const length = sources.reduce((maxLength, source, index) => {
    assertCompatibleAudioBuffer(source, { numberOfChannels, sampleRate });

    return Math.max(maxLength, offsets[index]! + source.length);
  }, 0);

  const target = createAudioBuffer({
    length,
    numberOfChannels,
    sampleRate,
  });

  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
    const source = sources[sourceIndex]!;
    const gain = requireFinite(options.gains?.[sourceIndex] ?? 1, "AudioBuffer mix gain");
    const offset = offsets[sourceIndex]!;

    const panGains = isNumber(options.pans?.[sourceIndex])
      ? getStereoPanGains(
          numberOfChannels,
          requireFinite(options.pans[sourceIndex]!, "AudioBuffer mix pan"),
        )
      : [];

    for (let channel = 0; channel < numberOfChannels; channel++) {
      const sourceData = getAudioBufferChannelData(source, channel);
      const targetData = getAudioBufferChannelData(target, channel);
      const channelGain = gain * (panGains[channel] ?? 1);

      for (let frame = 0; frame < sourceData.length; frame++) {
        const targetFrame = offset + frame;
        targetData[targetFrame] =
          (targetData[targetFrame] ?? 0) + (sourceData[frame] ?? 0) * channelGain;
      }
    }
  }

  return target;
}

/**
 * Stacks the channels of `sources` into one multichannel `AudioBuffer`, in order.
 *
 * @throws {AudioRangeError} When `sources` is empty or the buffers differ in length or sample rate.
 */
export function mergeAudioBufferChannels(sources: readonly AudioBuffer[]): AudioBuffer {
  if (sources.length === 0) {
    AudioRangeError.empty("AudioBuffer list");
  }

  const [first] = sources;
  const length = first!.length;
  const sampleRate = first!.sampleRate;

  const numberOfChannels = sources.reduce((total, source) => {
    if (source.sampleRate !== sampleRate) {
      AudioRangeError.mismatch("AudioBuffer sample rate", sampleRate, source.sampleRate);
    }

    if (source.length !== length) {
      AudioRangeError.mismatch("AudioBuffer length", length, source.length);
    }

    return total + source.numberOfChannels;
  }, 0);

  const target = createAudioBuffer({
    length,
    numberOfChannels,
    sampleRate,
  });

  let targetChannel = 0;

  for (const source of sources) {
    for (let channel = 0; channel < source.numberOfChannels; channel++) {
      target.copyToChannel(
        Float32Array.from(getAudioBufferChannelData(source, channel)),
        targetChannel,
      );
      targetChannel++;
    }
  }

  return target;
}

/**
 * Returns one mono `AudioBuffer` per channel of `source`.
 */
export function splitAudioBufferChannels(source: AudioBuffer): AudioBuffer[] {
  return Array.from({ length: source.numberOfChannels }, (_value, channel) =>
    createAudioBufferFromChannels([getAudioBufferChannelData(source, channel)], {
      sampleRate: source.sampleRate,
    }),
  );
}
