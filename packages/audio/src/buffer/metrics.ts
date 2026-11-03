import { AudioRangeError } from "../errors.ts";
import { getAudioBufferChannelData } from "./serialization.ts";

export type AudioBufferChannelExtrema = {
  readonly max: number;
  readonly min: number;
};

/**
 * Returns the largest absolute sample value across all channels.
 */
export function getAudioBufferPeak(buffer: AudioBuffer): number {
  return getAudioBufferChannelPeaks(buffer).reduce(
    (peak, channelPeak) => Math.max(peak, channelPeak),
    0,
  );
}

/**
 * Returns the largest absolute sample value of each channel.
 */
export function getAudioBufferChannelPeaks(buffer: AudioBuffer): Float32Array<ArrayBuffer> {
  const peaks = new Float32Array(buffer.numberOfChannels);

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = getAudioBufferChannelData(buffer, channel);
    let peak = 0;

    for (let index = 0; index < data.length; index++) {
      peak = Math.max(peak, Math.abs(data[index] ?? 0));
    }

    peaks[channel] = peak;
  }

  return peaks;
}

/**
 * Returns the smallest and largest sample values across all channels.
 */
export function getAudioBufferExtrema(buffer: AudioBuffer): AudioBufferChannelExtrema {
  const [first, ...rest] = getAudioBufferChannelExtrema(buffer);

  if (first === undefined) {
    return { max: 0, min: 0 };
  }

  return rest.reduce<AudioBufferChannelExtrema>(
    (extrema, channelExtrema) => ({
      max: Math.max(extrema.max, channelExtrema.max),
      min: Math.min(extrema.min, channelExtrema.min),
    }),
    first,
  );
}

/**
 * Returns the smallest and largest sample values of each channel.
 */
export function getAudioBufferChannelExtrema(
  buffer: AudioBuffer,
): readonly AudioBufferChannelExtrema[] {
  return Array.from({ length: buffer.numberOfChannels }, (_value, channel) => {
    const data = getAudioBufferChannelData(buffer, channel);

    if (data.length === 0) {
      return { max: 0, min: 0 };
    }

    let min = data[0] ?? 0;
    let max = data[0] ?? 0;

    for (let index = 1; index < data.length; index++) {
      const sample = data[index] ?? 0;
      min = Math.min(min, sample);
      max = Math.max(max, sample);
    }

    return { max, min };
  });
}

/**
 * Returns the root mean square level across all channels, in linear amplitude.
 */
export function getAudioBufferRms(buffer: AudioBuffer): number {
  const sampleCount = buffer.length * buffer.numberOfChannels;

  if (sampleCount === 0) {
    return 0;
  }

  let sum = 0;

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = getAudioBufferChannelData(buffer, channel);

    for (let index = 0; index < data.length; index++) {
      const sample = data[index] ?? 0;
      sum += sample * sample;
    }
  }

  return Math.sqrt(sum / sampleCount);
}

/**
 * Returns the root mean square level of each channel, in linear amplitude.
 */
export function getAudioBufferChannelRms(buffer: AudioBuffer): Float32Array<ArrayBuffer> {
  const rms = new Float32Array(buffer.numberOfChannels);

  if (buffer.length === 0) {
    return rms;
  }

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = getAudioBufferChannelData(buffer, channel);
    let sum = 0;

    for (let index = 0; index < data.length; index++) {
      const sample = data[index] ?? 0;
      sum += sample * sample;
    }

    rms[channel] = Math.sqrt(sum / data.length);
  }

  return rms;
}

/**
 * Returns the zero-crossing rate averaged over the channels. See
 * `getAudioBufferChannelZeroCrossingRates()`.
 */
export function getAudioBufferZeroCrossingRate(buffer: AudioBuffer): number {
  const rates = getAudioBufferChannelZeroCrossingRates(buffer);

  if (rates.length === 0) {
    return 0;
  }

  return rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
}

/**
 * Returns, per channel, the sign changes divided by the number of adjacent sample pairs. Samples at
 * exactly 0 are skipped, so `+`, `0`, `-` counts as one crossing.
 */
export function getAudioBufferChannelZeroCrossingRates(
  buffer: AudioBuffer,
): Float32Array<ArrayBuffer> {
  const rates = new Float32Array(buffer.numberOfChannels);

  if (buffer.length < 2) {
    return rates;
  }

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = getAudioBufferChannelData(buffer, channel);
    let crossings = 0;
    let previousSign = 0;

    for (let index = 0; index < data.length; index++) {
      const sample = data[index] ?? 0;
      const sign = sample > 0 ? 1 : sample < 0 ? -1 : 0;

      if (sign === 0) {
        continue;
      }

      if (previousSign !== 0 && sign !== previousSign) {
        crossings++;
      }

      previousSign = sign;
    }

    rates[channel] = crossings / (buffer.length - 1);
  }

  return rates;
}

/**
 * Returns the correlation between the left and right channels, from -1 (opposite polarity) through
 * 0 (unrelated) to 1 (mono). A silent buffer reports 0.
 *
 * @throws {AudioRangeError} When `buffer` is not stereo.
 */
export function getStereoAudioBufferCorrelation(buffer: AudioBuffer): number {
  if (buffer.numberOfChannels !== 2) {
    AudioRangeError.mismatch("stereo correlation channel count", 2, buffer.numberOfChannels);
  }

  if (buffer.length === 0) {
    return 0;
  }

  const left = getAudioBufferChannelData(buffer, 0);
  const right = getAudioBufferChannelData(buffer, 1);
  let sum = 0;
  let leftSum = 0;
  let rightSum = 0;

  for (let index = 0; index < buffer.length; index++) {
    const leftSample = left[index] ?? 0;
    const rightSample = right[index] ?? 0;
    sum += leftSample * rightSample;
    leftSum += leftSample * leftSample;
    rightSum += rightSample * rightSample;
  }

  const denominator = Math.sqrt(leftSum * rightSum);

  return denominator === 0 ? 0 : sum / denominator;
}

/**
 * Returns the stereo width, `(1 - correlation) / 2`. Identical channels give 0 and channels with
 * opposite polarity give 1.
 *
 * @throws {AudioRangeError} When `buffer` is not stereo.
 */
export function getStereoAudioBufferWidth(buffer: AudioBuffer): number {
  const correlation = getStereoAudioBufferCorrelation(buffer);

  return (1 - correlation) / 2;
}

/**
 * Returns the mean sample value (DC offset) of each channel.
 */
export function getAudioBufferChannelDcOffsets(buffer: AudioBuffer): Float32Array<ArrayBuffer> {
  const offsets = new Float32Array(buffer.numberOfChannels);

  if (buffer.length === 0) {
    return offsets;
  }

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = getAudioBufferChannelData(buffer, channel);
    let sum = 0;

    for (let index = 0; index < data.length; index++) {
      sum += data[index] ?? 0;
    }

    offsets[channel] = sum / data.length;
  }

  return offsets;
}
