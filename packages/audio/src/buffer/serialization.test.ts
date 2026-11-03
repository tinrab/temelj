import { assert, describe, expect, it } from "vitest";

import { createMockDecodeAudioContext } from "../../tests/audio.ts";
import {
  audioBufferToArray,
  audioBufferToInterleavedArray,
  audioBufferToWavArrayBuffer,
  audioBufferToWavBlob,
  createAudioBufferFromChannels,
  createAudioBufferFromInterleavedArray,
  getAudioBufferChannelData,
  getAudioBufferChannels,
  getAudioBufferInfo,
} from "../mod.ts";

function createMockContext(sampleRate = 48_000): BaseAudioContext {
  return createMockDecodeAudioContext(sampleRate);
}

function readAscii(view: DataView, offset: number, length: number): string {
  return String.fromCharCode(
    ...Array.from({ length }, (_value, index) => view.getUint8(offset + index)),
  );
}

describe("AudioBuffer serialization", () => {
  it("creates and exports AudioBuffers from interleaved sample arrays", () => {
    const buffer = createAudioBufferFromInterleavedArray([1, 0.5, 0, -0.5, -1, -0.25], {
      numberOfChannels: 2,
      sampleRate: 10,
    });

    expect(buffer.numberOfChannels).toBe(2);
    expect(buffer.length).toBe(3);
    expect(buffer.sampleRate).toBe(10);
    expect(Array.from(buffer.getChannelData(0))).toEqual([1, 0, -1]);
    expect(Array.from(buffer.getChannelData(1))).toEqual([0.5, -0.5, -0.25]);
    expect(Array.from(audioBufferToInterleavedArray(buffer))).toEqual([1, 0.5, 0, -0.5, -1, -0.25]);
  });

  it("exports AudioBuffers to an owned interleaved array", () => {
    const context = createMockContext();

    const buffer = createAudioBufferFromChannels(
      [
        [1, 0],
        [0.5, -0.5],
      ],
      { sampleRate: context.sampleRate },
    );

    const data = audioBufferToInterleavedArray(buffer);
    buffer.getChannelData(0)[0] = 0;

    expect(data).toBeInstanceOf(Float32Array);
    expect(Array.from(data)).toEqual([1, 0.5, 0, -0.5]);
  });

  it("exports AudioBuffers to 16-bit PCM WAV ArrayBuffers", () => {
    const buffer = createAudioBufferFromChannels(
      [
        [-1, 0, 1],
        [0.5, -0.5, 2],
      ],
      {
        sampleRate: 8_000,
      },
    );

    const wav = audioBufferToWavArrayBuffer(buffer);
    const view = new DataView(wav);

    expect(readAscii(view, 0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(48);
    expect(readAscii(view, 8, 4)).toBe("WAVE");
    expect(readAscii(view, 12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(8_000);
    expect(view.getUint32(28, true)).toBe(32_000);
    expect(view.getUint16(32, true)).toBe(4);
    expect(view.getUint16(34, true)).toBe(16);
    expect(readAscii(view, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(12);
    expect(view.getInt16(44, true)).toBe(-32_768);
    expect(view.getInt16(46, true)).toBe(16_383);
    expect(view.getInt16(48, true)).toBe(0);
    expect(view.getInt16(50, true)).toBe(-16_384);
    expect(view.getInt16(52, true)).toBe(32_767);
    expect(view.getInt16(54, true)).toBe(32_767);
  });

  it("exports AudioBuffers to float WAV data and Blob objects", async () => {
    const buffer = createAudioBufferFromChannels([[-1.5, 0.25, Number.NaN]], {
      sampleRate: 10,
    });

    const wav = audioBufferToWavArrayBuffer(buffer, { float: true });
    const view = new DataView(wav);
    const blob = audioBufferToWavBlob(buffer, { float: true });

    expect(view.getUint16(20, true)).toBe(3);
    expect(view.getUint16(34, true)).toBe(32);
    expect(view.getUint32(40, true)).toBe(12);
    expect(view.getFloat32(44, true)).toBe(-1);
    expect(view.getFloat32(48, true)).toBe(0.25);
    expect(view.getFloat32(52, true)).toBe(0);
    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBe(wav.byteLength);
    await expect(blob.arrayBuffer()).resolves.toHaveProperty("byteLength", wav.byteLength);
  });

  it("exports mono AudioBuffers to an owned array", () => {
    const context = createMockContext();
    const buffer = createAudioBufferFromChannels([[0, 0.5, 1]], { sampleRate: context.sampleRate });

    const data = audioBufferToArray(buffer);
    buffer.getChannelData(0)[0] = 1;

    assert(data instanceof Float32Array);
    expect(Array.from(data)).toEqual([0, 0.5, 1]);
  });

  it("exports multichannel AudioBuffers to owned channel arrays", () => {
    const context = createMockContext();

    const buffer = createAudioBufferFromChannels(
      [
        [1, 0],
        [0, 1],
      ],
      { sampleRate: context.sampleRate },
    );

    const channels = audioBufferToArray(buffer);
    buffer.getChannelData(0)[0] = 0.25;

    assert(Array.isArray(channels));
    expect(channels.map((channel) => Array.from(channel))).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it("exports a selected AudioBuffer channel to an owned array", () => {
    const context = createMockContext();

    const buffer = createAudioBufferFromChannels(
      [
        [1, 0],
        [0, 1],
      ],
      { sampleRate: context.sampleRate },
    );

    const data = audioBufferToArray(buffer, { channel: 1 });

    expect(Array.from(data)).toEqual([0, 1]);
    expect(() => audioBufferToArray(buffer, { channel: 2 })).toThrow(RangeError);
  });

  it("returns live channel views and validates channel indexes", () => {
    const context = createMockContext();
    const buffer = createAudioBufferFromChannels([[0], [1]], { sampleRate: context.sampleRate });

    expect(getAudioBufferChannelData(buffer, 1)).toBe(buffer.getChannelData(1));
    expect(getAudioBufferChannels(buffer)).toEqual([
      buffer.getChannelData(0),
      buffer.getChannelData(1),
    ]);
    expect(() => getAudioBufferChannelData(buffer, 2)).toThrow(RangeError);
  });

  it("returns AudioBuffer metadata", () => {
    const buffer = createAudioBufferFromChannels(
      [
        [0, 0.5],
        [1, 0],
      ],
      {
        sampleRate: 24_000,
      },
    );

    expect(getAudioBufferInfo(buffer)).toEqual({
      bitsPerSample: 32,
      duration: 2 / 24_000,
      length: 2,
      numberOfChannels: 2,
      sampleRate: 24_000,
    });
  });
});
