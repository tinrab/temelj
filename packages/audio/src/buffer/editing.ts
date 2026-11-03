import { isNumber } from "@temelj/value";

import { AudioRangeError } from "../errors.ts";
import {
  floorNonNegative,
  floorPositive,
  requireFinite,
  requireNonNegative,
  requireNonNegativeInteger,
  requirePositive,
  snapToFrame,
} from "../validation.ts";
import { resampleAudioBufferChannel } from "./channel.ts";
import {
  concatAudioBuffers,
  copyAudioBuffer,
  createAudioBuffer,
  createAudioBufferFromChannels,
} from "./creation.ts";
import {
  assertCompatibleAudioBuffer,
  assertStereoAudioBuffer,
  getFrameRange,
  isSilentFrame,
  secondsToFrame,
  secondsToSignedFrame,
} from "./frames.ts";
import { getAudioBufferChannelDcOffsets, getAudioBufferPeak } from "./metrics.ts";
import { getAudioBufferChannelData } from "./serialization.ts";

export type SliceAudioBufferOptions = {
  readonly end?: number;
  readonly start?: number;
};

export type MixAudioBufferToMonoOptions = {
  readonly channel?: number;
};

export type ConvertAudioBufferChannelsOptions = {
  readonly numberOfChannels: number;
};

export type ResampleAudioBufferOptions = {
  readonly sampleRate: number;
};

export type ResizeAudioBufferOptions = {
  readonly duration?: number;
  readonly length?: number;
};

export type CrossFadeAudioBuffersOptions = {
  readonly duration: number;
};

export type RepeatAudioBufferOptions = {
  readonly count: number;
  readonly crossFade?: number;
};

export type ReplaceAudioBufferRangeOptions = SliceAudioBufferOptions;

export type SilenceAudioBufferRangeOptions = SliceAudioBufferOptions;

export type DeleteAudioBufferRangeOptions = SliceAudioBufferOptions;

export type SoloAudioBufferRangeOptions = SliceAudioBufferOptions;

export type CreateAudioBufferLoopOptions = SliceAudioBufferOptions & {
  readonly crossFade?: number;
  readonly repetitions?: number;
};

export type NormalizeAudioBufferOptions = {
  readonly peak?: number;
};

export type ClampAudioBufferOptions = {
  readonly max?: number;
  readonly min?: number;
};

export type ScaleAudioBufferOptions = {
  readonly gain: number;
};

export type MapAudioBufferSamplesOptions = {
  readonly fromMax: number;
  readonly fromMin: number;
  readonly toMax: number;
  readonly toMin: number;
};

export type AddAudioBufferDcOffsetOptions = {
  readonly offset: number | readonly number[];
};

export type SetStereoAudioBufferWidthOptions = {
  readonly width: number;
};

export type ShiftAudioBufferOptions = {
  readonly offset: number;
};

export type RotateAudioBufferOptions = {
  readonly offset: number;
};

export type TrimAudioBufferOptions = {
  readonly threshold?: number;
};

export type FadeAudioBufferOptions = {
  readonly fadeIn?: number;
  readonly fadeOut?: number;
};

export type PadAudioBufferOptions = {
  readonly after?: number;
  readonly before?: number;
};

/**
 * Joins `first` and `second`, overlapping the end of `first` with the start of `second` by
 * `options.duration` seconds with a linear crossfade. The result is shorter than the two inputs
 * combined by the overlap.
 *
 * @throws {AudioRangeError} When the buffers differ in channel count or sample rate, or `duration`
 * does not fall on a whole sample frame.
 */
export function crossFadeAudioBuffers(
  first: AudioBuffer,
  second: AudioBuffer,
  options: CrossFadeAudioBuffersOptions,
): AudioBuffer {
  assertCompatibleAudioBuffer(second, {
    numberOfChannels: first.numberOfChannels,
    sampleRate: first.sampleRate,
  });

  const overlapFrames = Math.min(
    first.length,
    second.length,
    secondsToFrame(options.duration, first.sampleRate, "AudioBuffer crossfade frame"),
  );

  if (overlapFrames === 0) {
    return concatAudioBuffers([first, second]);
  }

  const target = createAudioBuffer({
    length: first.length + second.length - overlapFrames,
    numberOfChannels: first.numberOfChannels,
    sampleRate: first.sampleRate,
  });

  const firstTailStart = first.length - overlapFrames;

  for (let channel = 0; channel < first.numberOfChannels; channel++) {
    const firstData = getAudioBufferChannelData(first, channel);
    const secondData = getAudioBufferChannelData(second, channel);
    const targetData = getAudioBufferChannelData(target, channel);

    targetData.set(firstData.subarray(0, firstTailStart));

    for (let index = 0; index < overlapFrames; index++) {
      const fadeIn = overlapFrames === 1 ? 1 : index / (overlapFrames - 1);
      targetData[firstTailStart + index] =
        (firstData[firstTailStart + index] ?? 0) * (1 - fadeIn) + (secondData[index] ?? 0) * fadeIn;
    }

    targetData.set(secondData.subarray(overlapFrames), first.length);
  }

  return target;
}

/**
 * Repeats `source` `options.count` times (rounded down). `options.crossFade` (seconds) overlaps
 * each repetition with the next.
 *
 * @throws {AudioRangeError} When `count` is below 1 or `crossFade` does not fall on a whole sample
 * frame.
 */
export function repeatAudioBuffer(
  source: AudioBuffer,
  options: RepeatAudioBufferOptions,
): AudioBuffer {
  const count = floorPositive(options.count, "AudioBuffer repeat count");

  if (count === 1) {
    return copyAudioBuffer(source);
  }

  const crossFade = options.crossFade ?? 0;

  if (crossFade === 0) {
    return concatAudioBuffers(Array.from({ length: count }, () => source));
  }

  let repeated = copyAudioBuffer(source);

  for (let index = 1; index < count; index++) {
    repeated = crossFadeAudioBuffers(repeated, source, { duration: crossFade });
  }

  return repeated;
}

/**
 * Cuts the `start`–`end` range (seconds) out of `source` and repeats it `options.repetitions` times
 * (1 by default), optionally crossfading the joins by `options.crossFade` seconds.
 *
 * @throws {AudioRangeError} When the range is empty or reversed, or a time does not fall on a whole
 * sample frame.
 */
export function createAudioBufferLoop(
  source: AudioBuffer,
  options: CreateAudioBufferLoopOptions = {},
): AudioBuffer {
  const loop = sliceAudioBuffer(source, {
    end: options.end,
    start: options.start,
  });

  if (isNumber(options.crossFade)) {
    secondsToFrame(options.crossFade, loop.sampleRate, "AudioBuffer crossfade frame");
  }

  return repeatAudioBuffer(loop, {
    count: options.repetitions ?? 1,
    crossFade: options.crossFade,
  });
}

/**
 * Returns `source` with the `start`–`end` range (seconds) replaced by `replacement`. The result
 * grows or shrinks when the replacement differs in length from the range.
 *
 * @throws {AudioRangeError} When `replacement` differs in channel count or sample rate, or the
 * range is reversed. Times must also fall on whole sample frames.
 */
export function replaceAudioBufferRange(
  source: AudioBuffer,
  replacement: AudioBuffer,
  options: ReplaceAudioBufferRangeOptions = {},
): AudioBuffer {
  assertCompatibleAudioBuffer(replacement, {
    numberOfChannels: source.numberOfChannels,
    sampleRate: source.sampleRate,
  });

  const [startFrame, endFrame] = getFrameRange(source, options, "AudioBuffer replace range");

  const prefixLength = Math.min(source.length, startFrame);
  const suffixStart = Math.min(source.length, endFrame);
  const suffixLength = source.length - suffixStart;

  const target = createAudioBuffer({
    length: prefixLength + replacement.length + suffixLength,
    numberOfChannels: source.numberOfChannels,
    sampleRate: source.sampleRate,
  });

  for (let channel = 0; channel < source.numberOfChannels; channel++) {
    const sourceData = getAudioBufferChannelData(source, channel);
    const targetData = getAudioBufferChannelData(target, channel);
    targetData.set(sourceData.subarray(0, prefixLength));
    targetData.set(getAudioBufferChannelData(replacement, channel), prefixLength);
    targetData.set(sourceData.subarray(suffixStart), prefixLength + replacement.length);
  }

  return target;
}

/**
 * Returns `source` with the `start`–`end` range (seconds) removed and the rest joined up, so the
 * result is shorter by the length of the range.
 *
 * @throws {AudioRangeError} When the range covers the whole buffer (Web Audio has no empty
 * buffers), or when the range is reversed or does not align to a whole sample frame.
 */
export function deleteAudioBufferRange(
  source: AudioBuffer,
  options: DeleteAudioBufferRangeOptions = {},
): AudioBuffer {
  const [startFrame, endFrame] = getFrameRange(source, options, "AudioBuffer delete range");
  const start = Math.min(source.length, startFrame);
  const end = Math.min(source.length, endFrame);

  const target = createAudioBuffer({
    length: source.length - (end - start),
    numberOfChannels: source.numberOfChannels,
    sampleRate: source.sampleRate,
  });

  for (let channel = 0; channel < source.numberOfChannels; channel++) {
    const sourceData = getAudioBufferChannelData(source, channel);
    const targetData = getAudioBufferChannelData(target, channel);
    targetData.set(sourceData.subarray(0, start));
    targetData.set(sourceData.subarray(end), start);
  }

  return target;
}

/**
 * Returns a copy of `source` with the `start`–`end` range (seconds) set to silence.
 *
 * @throws {AudioRangeError} When the range is reversed or a time does not fall on a whole sample
 * frame.
 */
export function silenceAudioBufferRange(
  source: AudioBuffer,
  options: SilenceAudioBufferRangeOptions = {},
): AudioBuffer {
  const [startFrame, endFrame] = getFrameRange(source, options, "AudioBuffer silence range");

  const target = copyAudioBuffer(source);
  const start = Math.min(target.length, startFrame);
  const end = Math.min(target.length, endFrame);

  for (let channel = 0; channel < target.numberOfChannels; channel++) {
    getAudioBufferChannelData(target, channel).fill(0, start, end);
  }

  return target;
}

/**
 * Returns a copy of `source` that keeps only the `start`–`end` range (seconds) and silences
 * everything else. The length is unchanged.
 *
 * @throws {AudioRangeError} When the range is reversed or a time does not fall on a whole sample
 * frame.
 */
export function soloAudioBufferRange(
  source: AudioBuffer,
  options: SoloAudioBufferRangeOptions = {},
): AudioBuffer {
  const [startFrame, endFrame] = getFrameRange(source, options, "AudioBuffer solo range");

  const target = createAudioBuffer({
    length: source.length,
    numberOfChannels: source.numberOfChannels,
    sampleRate: source.sampleRate,
  });

  const start = Math.min(target.length, startFrame);
  const end = Math.min(target.length, endFrame);

  for (let channel = 0; channel < target.numberOfChannels; channel++) {
    const targetData = getAudioBufferChannelData(target, channel);
    targetData.set(getAudioBufferChannelData(source, channel).subarray(start, end), start);
  }

  return target;
}

/**
 * Adds `options.before` and `options.after` seconds of silence around `source`.
 *
 * @throws {AudioRangeError} When either amount is negative or does not fall on a whole sample
 * frame.
 */
export function padAudioBuffer(
  source: AudioBuffer,
  options: PadAudioBufferOptions = {},
): AudioBuffer {
  const beforeFrames = secondsToFrame(
    options.before ?? 0,
    source.sampleRate,
    "AudioBuffer pad frame",
  );

  const afterFrames = secondsToFrame(
    options.after ?? 0,
    source.sampleRate,
    "AudioBuffer pad frame",
  );

  const target = createAudioBuffer({
    length: beforeFrames + source.length + afterFrames,
    numberOfChannels: source.numberOfChannels,
    sampleRate: source.sampleRate,
  });

  for (let channel = 0; channel < source.numberOfChannels; channel++) {
    target.copyToChannel(
      Float32Array.from(getAudioBufferChannelData(source, channel)),
      channel,
      beforeFrames,
    );
  }

  return target;
}

/**
 * Moves the samples of `source` by `options.offset` seconds (positive moves later) without changing
 * the length. Samples shifted past either end are dropped and the gap is filled with silence.
 *
 * @throws {AudioRangeError} When `offset` does not fall on a whole sample frame.
 */
export function shiftAudioBuffer(
  source: AudioBuffer,
  options: ShiftAudioBufferOptions,
): AudioBuffer {
  const offsetFrames = secondsToSignedFrame(options.offset, source.sampleRate);

  const target = createAudioBuffer({
    length: source.length,
    numberOfChannels: source.numberOfChannels,
    sampleRate: source.sampleRate,
  });

  if (source.length === 0 || Math.abs(offsetFrames) >= source.length) {
    return target;
  }

  const sourceStart = Math.max(0, -offsetFrames);
  const targetStart = Math.max(0, offsetFrames);
  const copyLength = source.length - Math.abs(offsetFrames);

  for (let channel = 0; channel < source.numberOfChannels; channel++) {
    const sourceData = getAudioBufferChannelData(source, channel).subarray(
      sourceStart,
      sourceStart + copyLength,
    );

    target.copyToChannel(Float32Array.from(sourceData), channel, targetStart);
  }

  return target;
}

/**
 * Returns `source` truncated or padded with silence to `options.length` frames or
 * `options.duration` seconds.
 *
 * @throws {AudioRangeError} When both `length` and `duration` are given, or the new length is below
 * one frame. `duration` must also fall on a whole sample frame.
 */
export function resizeAudioBuffer(
  source: AudioBuffer,
  options: ResizeAudioBufferOptions,
): AudioBuffer {
  if (isNumber(options.length) && isNumber(options.duration)) {
    AudioRangeError.invalidOption("resize", "both length and duration");
  }

  const length = isNumber(options.length)
    ? requireNonNegativeInteger(options.length, "AudioBuffer resize length")
    : isNumber(options.duration)
      ? secondsToFrame(options.duration, source.sampleRate, "AudioBuffer resize length")
      : source.length;

  const target = createAudioBuffer({
    length,
    numberOfChannels: source.numberOfChannels,
    sampleRate: source.sampleRate,
  });

  const copyLength = Math.min(source.length, length);

  for (let channel = 0; channel < source.numberOfChannels; channel++) {
    const sourceData = getAudioBufferChannelData(source, channel).subarray(0, copyLength);
    target.copyToChannel(Float32Array.from(sourceData), channel);
  }

  return target;
}

/**
 * Rotates the samples of `source` by `options.offset` seconds; samples that leave one end wrap
 * around to the other.
 *
 * @throws {AudioRangeError} When `offset` does not fall on a whole sample frame.
 */
export function rotateAudioBuffer(
  source: AudioBuffer,
  options: RotateAudioBufferOptions,
): AudioBuffer {
  const target = createAudioBuffer({
    length: source.length,
    numberOfChannels: source.numberOfChannels,
    sampleRate: source.sampleRate,
  });

  if (source.length === 0) {
    return target;
  }

  const offsetFrames = secondsToSignedFrame(options.offset, source.sampleRate);
  const shift = ((offsetFrames % source.length) + source.length) % source.length;

  for (let channel = 0; channel < source.numberOfChannels; channel++) {
    const sourceData = getAudioBufferChannelData(source, channel);
    const targetData = getAudioBufferChannelData(target, channel);
    targetData.set(sourceData.subarray(source.length - shift), 0);
    targetData.set(sourceData.subarray(0, source.length - shift), shift);
  }

  return target;
}

/**
 * Returns a copy of `source` played backwards.
 */
export function reverseAudioBuffer(source: AudioBuffer): AudioBuffer {
  const target = createAudioBuffer({
    length: source.length,
    numberOfChannels: source.numberOfChannels,
    sampleRate: source.sampleRate,
  });

  for (let channel = 0; channel < source.numberOfChannels; channel++) {
    target.copyToChannel(
      Float32Array.from(getAudioBufferChannelData(source, channel)).reverse(),
      channel,
    );
  }

  return target;
}

/**
 * Returns the `start`–`end` range (seconds) of `source`. A range that extends past the end is
 * padded with silence.
 *
 * @throws {AudioRangeError} When the range is empty or reversed, or does not align to a whole
 * sample frame.
 */
export function sliceAudioBuffer(
  source: AudioBuffer,
  options: SliceAudioBufferOptions = {},
): AudioBuffer {
  const startFrame = secondsToFrame(options.start ?? 0, source.sampleRate);
  const endFrame = secondsToFrame(options.end ?? source.duration, source.sampleRate);

  if (startFrame > endFrame) {
    AudioRangeError.invalidRange("AudioBuffer slice", startFrame, endFrame);
  }

  if (startFrame === endFrame) {
    AudioRangeError.empty("AudioBuffer slice");
  }

  const length = endFrame - startFrame;

  const target = createAudioBuffer({
    length,
    numberOfChannels: source.numberOfChannels,
    sampleRate: source.sampleRate,
  });

  const sourceStartFrame = Math.min(source.length, startFrame);
  const sourceEndFrame = Math.min(source.length, endFrame);

  for (let channel = 0; channel < source.numberOfChannels; channel++) {
    const sourceData = getAudioBufferChannelData(source, channel).subarray(
      sourceStartFrame,
      sourceEndFrame,
    );

    if (sourceData.length === 0) {
      continue;
    }

    target.copyToChannel(Float32Array.from(sourceData), channel, sourceStartFrame - startFrame);
  }

  return target;
}

/**
 * Averages every channel of `source` into a mono `AudioBuffer`, or extracts `options.channel` when
 * it is set.
 *
 * @throws {AudioRangeError} When `options.channel` is out of range.
 */
export function mixAudioBufferToMono(
  source: AudioBuffer,
  options: MixAudioBufferToMonoOptions = {},
): AudioBuffer {
  if (isNumber(options.channel)) {
    const channelData = getAudioBufferChannelData(source, options.channel);

    return createAudioBufferFromChannels([channelData], {
      sampleRate: source.sampleRate,
    });
  }

  const mixed = new Float32Array(source.length);

  for (let channel = 0; channel < source.numberOfChannels; channel++) {
    const channelData = getAudioBufferChannelData(source, channel);

    for (let index = 0; index < channelData.length; index++) {
      mixed[index] += channelData[index]! / source.numberOfChannels;
    }
  }

  return createAudioBufferFromChannels([mixed], {
    sampleRate: source.sampleRate,
  });
}

/**
 * Converts `source` to `options.numberOfChannels` channels. Converting to mono averages the
 * channels. Any other count takes the source channels in order, starting over when it runs out:
 * stereo to four channels gives L R L R, while six channels to two keeps the first two.
 */
export function convertAudioBufferChannels(
  source: AudioBuffer,
  options: ConvertAudioBufferChannelsOptions,
): AudioBuffer {
  const numberOfChannels = floorPositive(options.numberOfChannels, "AudioBuffer channel count");

  if (numberOfChannels === source.numberOfChannels) {
    return copyAudioBuffer(source);
  }

  if (numberOfChannels === 1) {
    return mixAudioBufferToMono(source);
  }

  const channels = Array.from({ length: numberOfChannels }, (_value, channel) =>
    getAudioBufferChannelData(source, channel % source.numberOfChannels),
  );

  return createAudioBufferFromChannels(channels, {
    sampleRate: source.sampleRate,
  });
}

/**
 * Resamples `source` to `options.sampleRate` with linear interpolation, keeping its duration.
 */
export function resampleAudioBuffer(
  source: AudioBuffer,
  options: ResampleAudioBufferOptions,
): AudioBuffer {
  const sampleRate = requirePositive(options.sampleRate ?? source.sampleRate, "sampleRate");

  if (sampleRate === source.sampleRate) {
    return copyAudioBuffer(source);
  }

  const length = floorNonNegative(
    snapToFrame(source.duration * sampleRate),
    "AudioBuffer resample length",
  );

  const channels = Array.from({ length: source.numberOfChannels }, (_value, channel) =>
    resampleAudioBufferChannel(getAudioBufferChannelData(source, channel), length),
  );

  return createAudioBufferFromChannels(channels, { sampleRate });
}

/**
 * Encodes a stereo `source` as mid (`(L + R) / 2`) and side (`(L - R) / 2`) channels.
 *
 * @throws {AudioRangeError} When `source` is not stereo.
 */
export function stereoAudioBufferToMidSide(source: AudioBuffer): AudioBuffer {
  assertStereoAudioBuffer(source, "Stereo AudioBuffer mid-side conversion");
  const left = getAudioBufferChannelData(source, 0);
  const right = getAudioBufferChannelData(source, 1);
  const mid = new Float32Array(source.length);
  const side = new Float32Array(source.length);

  for (let index = 0; index < source.length; index++) {
    mid[index] = ((left[index] ?? 0) + (right[index] ?? 0)) / 2;
    side[index] = ((left[index] ?? 0) - (right[index] ?? 0)) / 2;
  }

  return createAudioBufferFromChannels([mid, side], {
    sampleRate: source.sampleRate,
  });
}

/**
 * Decodes a mid/side `source` (see `stereoAudioBufferToMidSide()`) back to left and right channels.
 *
 * @throws {AudioRangeError} When `source` does not have two channels.
 */
export function midSideAudioBufferToStereo(source: AudioBuffer): AudioBuffer {
  assertStereoAudioBuffer(source, "Mid-side AudioBuffer stereo conversion");
  const mid = getAudioBufferChannelData(source, 0);
  const side = getAudioBufferChannelData(source, 1);
  const left = new Float32Array(source.length);
  const right = new Float32Array(source.length);

  for (let index = 0; index < source.length; index++) {
    left[index] = (mid[index] ?? 0) + (side[index] ?? 0);
    right[index] = (mid[index] ?? 0) - (side[index] ?? 0);
  }

  return createAudioBufferFromChannels([left, right], {
    sampleRate: source.sampleRate,
  });
}

/**
 * Scales the side signal of a stereo `source` by `options.width`. A width of 0 collapses the buffer
 * to mono; values above 1 widen it.
 *
 * @throws {AudioRangeError} When `source` is not stereo or `width` is negative.
 */
export function setStereoAudioBufferWidth(
  source: AudioBuffer,
  options: SetStereoAudioBufferWidthOptions,
): AudioBuffer {
  assertStereoAudioBuffer(source, "Stereo AudioBuffer width");
  const width = requireNonNegative(options.width, "AudioBuffer stereo width");
  const left = getAudioBufferChannelData(source, 0);
  const right = getAudioBufferChannelData(source, 1);
  const targetLeft = new Float32Array(source.length);
  const targetRight = new Float32Array(source.length);

  for (let index = 0; index < source.length; index++) {
    const mid = ((left[index] ?? 0) + (right[index] ?? 0)) / 2;
    const side = (((left[index] ?? 0) - (right[index] ?? 0)) / 2) * width;
    targetLeft[index] = mid + side;
    targetRight[index] = mid - side;
  }

  return createAudioBufferFromChannels([targetLeft, targetRight], {
    sampleRate: source.sampleRate,
  });
}

/**
 * Multiplies every sample of `source` by `options.gain`.
 */
export function scaleAudioBuffer(
  source: AudioBuffer,
  options: ScaleAudioBufferOptions,
): AudioBuffer {
  const gain = requireFinite(options.gain, "AudioBuffer gain");

  return mapAudioBufferChannels(source, (sample) => sample * gain);
}

/**
 * Linearly maps every sample of `source` from the `fromMin`–`fromMax` range to the `toMin`–`toMax`
 * range.
 *
 * @throws {AudioRangeError} When `fromMin` equals `fromMax`.
 */
export function mapAudioBufferSamples(
  source: AudioBuffer,
  options: MapAudioBufferSamplesOptions,
): AudioBuffer {
  const fromMin = requireFinite(options.fromMin, "AudioBuffer sample source minimum");
  const fromMax = requireFinite(options.fromMax, "AudioBuffer sample source maximum");
  const toMin = requireFinite(options.toMin, "AudioBuffer sample target minimum");
  const toMax = requireFinite(options.toMax, "AudioBuffer sample target maximum");

  if (fromMin === fromMax) {
    AudioRangeError.invalidOption("AudioBuffer sample source range", fromMin);
  }

  const sourceRange = fromMax - fromMin;
  const targetRange = toMax - toMin;

  return mapAudioBufferChannels(
    source,
    (sample) => ((sample - fromMin) / sourceRange) * targetRange + toMin,
  );
}

/**
 * Adds `options.offset` to every sample of `source`. Pass an array to use a different offset per
 * channel; channels without an entry are left unchanged.
 */
export function addAudioBufferDcOffset(
  source: AudioBuffer,
  options: AddAudioBufferDcOffsetOptions,
): AudioBuffer {
  return mapAudioBufferChannels(source, (sample, _index, channel) => {
    const offset = isNumber(options.offset)
      ? requireFinite(options.offset, "AudioBuffer DC offset")
      : requireFinite(options.offset[channel] ?? 0, "AudioBuffer DC offset");

    return sample + offset;
  });
}

/**
 * Returns a copy of `source` with every sample negated (a polarity flip).
 */
export function invertAudioBuffer(source: AudioBuffer): AudioBuffer {
  return mapAudioBufferChannels(source, (sample) => (sample === 0 ? 0 : -sample));
}

/**
 * Subtracts each channel's mean from its samples, centering the waveform on zero.
 */
export function removeAudioBufferDcOffset(source: AudioBuffer): AudioBuffer {
  const offsets = getAudioBufferChannelDcOffsets(source);

  return mapAudioBufferChannels(source, (sample, _index, channel) => {
    const offset = offsets[channel] ?? 0;

    return sample - offset;
  });
}

/**
 * Limits every sample of `source` to `options.min`–`options.max` (-1 to 1 by default).
 */
export function clampAudioBuffer(
  source: AudioBuffer,
  options: ClampAudioBufferOptions = {},
): AudioBuffer {
  const min = requireFinite(options.min ?? -1, "AudioBuffer clamp minimum");
  const max = requireFinite(options.max ?? 1, "AudioBuffer clamp maximum");

  if (min > max) {
    AudioRangeError.invalidRange("AudioBuffer clamp", min, max);
  }

  return mapAudioBufferChannels(source, (sample) => Math.min(max, Math.max(min, sample)));
}

function mapAudioBufferChannels(
  source: AudioBuffer,
  mapSample: (sample: number, index: number, channel: number) => number,
): AudioBuffer {
  const channels = Array.from({ length: source.numberOfChannels }, (_value, channel) => {
    const sourceData = getAudioBufferChannelData(source, channel);
    const targetData = new Float32Array(sourceData.length);

    for (let index = 0; index < sourceData.length; index++) {
      targetData[index] = mapSample(sourceData[index] ?? 0, index, channel);
    }

    return targetData;
  });

  return createAudioBufferFromChannels(channels, {
    sampleRate: source.sampleRate,
  });
}

/**
 * Scales `source` so its loudest sample reaches `options.peak` (1 by default). A silent buffer
 * comes back as an unscaled copy.
 */
export function normalizeAudioBuffer(
  source: AudioBuffer,
  options: NormalizeAudioBufferOptions = {},
): AudioBuffer {
  const peak = getAudioBufferPeak(source);
  const targetPeak = requirePositive(options.peak ?? 1, "peak");

  if (peak === 0) {
    return copyAudioBuffer(source);
  }

  return scaleAudioBuffer(source, { gain: targetPeak / peak });
}

/**
 * Removes leading and trailing frames whose samples are all at or below `options.threshold` (0 by
 * default) in absolute value. A buffer that is all silence trims to one silent frame, because Web
 * Audio has no empty buffers.
 */
export function trimAudioBuffer(
  source: AudioBuffer,
  options: TrimAudioBufferOptions = {},
): AudioBuffer {
  const threshold = requireNonNegative(options.threshold ?? 0, "threshold");
  let startFrame = 0;
  let endFrame = source.length;

  while (startFrame < endFrame && isSilentFrame(source, startFrame, threshold)) {
    startFrame++;
  }

  while (endFrame > startFrame && isSilentFrame(source, endFrame - 1, threshold)) {
    endFrame--;
  }

  // Web Audio has no empty buffers, so trimming pure silence leaves one silent frame.
  if (startFrame === endFrame) {
    return createAudioBuffer({
      length: 1,
      numberOfChannels: source.numberOfChannels,
      sampleRate: source.sampleRate,
    });
  }

  return sliceAudioBuffer(source, {
    end: endFrame / source.sampleRate,
    start: startFrame / source.sampleRate,
  });
}

/**
 * Applies linear fades of `options.fadeIn` and `options.fadeOut` seconds to the start and end of
 * `source`.
 *
 * @throws {AudioRangeError} When a fade length is negative or does not fall on a whole sample
 * frame.
 */
export function fadeAudioBuffer(
  source: AudioBuffer,
  options: FadeAudioBufferOptions = {},
): AudioBuffer {
  const fadeInFrames = Math.min(
    source.length,
    secondsToFrame(options.fadeIn ?? 0, source.sampleRate, "AudioBuffer fade frame"),
  );

  const fadeOutFrames = Math.min(
    source.length,
    secondsToFrame(options.fadeOut ?? 0, source.sampleRate, "AudioBuffer fade frame"),
  );

  const target = copyAudioBuffer(source);

  for (let channel = 0; channel < target.numberOfChannels; channel++) {
    const data = getAudioBufferChannelData(target, channel);

    for (let index = 0; index < fadeInFrames; index++) {
      data[index] = (data[index] ?? 0) * (index / fadeInFrames);
    }

    for (let index = 0; index < fadeOutFrames; index++) {
      const frame = data.length - 1 - index;
      data[frame] = (data[frame] ?? 0) * (index / fadeOutFrames);
    }
  }

  return target;
}
