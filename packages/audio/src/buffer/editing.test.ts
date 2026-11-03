import { describe, expect, it } from "vitest";

import { createMockDecodeAudioContext } from "../../tests/audio.ts";
import {
  deleteAudioBufferRange,
  copyAudioBuffer,
  createAudioBufferFromChannels,
  createAudioBufferLoop,
  crossFadeAudioBuffers,
  fadeAudioBuffer,
  padAudioBuffer,
  repeatAudioBuffer,
  replaceAudioBufferRange,
  resizeAudioBuffer,
  reverseAudioBuffer,
  rotateAudioBuffer,
  shiftAudioBuffer,
  silenceAudioBufferRange,
  sliceAudioBuffer,
  soloAudioBufferRange,
} from "../mod.ts";

function createMockContext(sampleRate = 48_000): BaseAudioContext {
  return createMockDecodeAudioContext(sampleRate);
}

describe("AudioBuffer editing", () => {
  it("copies and reverses buffers without mutating the source", () => {
    const context = createMockContext();

    const source = createAudioBufferFromChannels([[0, 0.25, 0.5]], {
      sampleRate: context.sampleRate,
    });

    const copy = copyAudioBuffer(source);
    const reversed = reverseAudioBuffer(source);

    expect(copy).not.toBe(source);
    expect(Array.from(copy.getChannelData(0))).toEqual([0, 0.25, 0.5]);
    expect(Array.from(reversed.getChannelData(0))).toEqual([0.5, 0.25, 0]);
    expect(Array.from(source.getChannelData(0))).toEqual([0, 0.25, 0.5]);
  });

  it("crossfades compatible AudioBuffers without mutating sources", () => {
    const first = createAudioBufferFromChannels(
      [
        [1, 1, 1, 1],
        [0, 0, 0, 0],
      ],
      {
        sampleRate: 10,
      },
    );

    const second = createAudioBufferFromChannels(
      [
        [0, 0, 0, 0],
        [1, 1, 1, 1],
      ],
      {
        sampleRate: 10,
      },
    );

    const mixed = crossFadeAudioBuffers(first, second, { duration: 0.3 });

    expect(mixed.length).toBe(5);
    expect(mixed.numberOfChannels).toBe(2);
    expect(Array.from(mixed.getChannelData(0))).toEqual([1, 1, 0.5, 0, 0]);
    expect(Array.from(mixed.getChannelData(1))).toEqual([0, 0, 0.5, 1, 1]);
    expect(Array.from(first.getChannelData(0))).toEqual([1, 1, 1, 1]);
  });

  it("handles zero and clamped AudioBuffer crossfades", () => {
    const first = createAudioBufferFromChannels([[1, 1]], { sampleRate: 10 });
    const second = createAudioBufferFromChannels([[0, 0, 0]], { sampleRate: 10 });

    const concatenated = crossFadeAudioBuffers(first, second, { duration: 0 });
    const clamped = crossFadeAudioBuffers(first, second, { duration: 1 });

    expect(Array.from(concatenated.getChannelData(0))).toEqual([1, 1, 0, 0, 0]);
    expect(clamped.length).toBe(3);
    expect(Array.from(clamped.getChannelData(0))).toEqual([1, 0, 0]);
  });

  it("rejects invalid AudioBuffer crossfade inputs", () => {
    const first = createAudioBufferFromChannels([[1]], { sampleRate: 10 });
    const differentRate = createAudioBufferFromChannels([[0]], { sampleRate: 20 });

    const differentChannels = createAudioBufferFromChannels([[0], [1]], {
      sampleRate: 10,
    });

    expect(() => crossFadeAudioBuffers(first, differentRate, { duration: 0.1 })).toThrow(
      RangeError,
    );
    expect(() => crossFadeAudioBuffers(first, differentChannels, { duration: 0.1 })).toThrow(
      RangeError,
    );
    expect(() => crossFadeAudioBuffers(first, first, { duration: -1 })).toThrow(RangeError);
  });

  it("repeats AudioBuffers without mutating the source", () => {
    const source = createAudioBufferFromChannels(
      [
        [1, 0],
        [0, 1],
      ],
      {
        sampleRate: 10,
      },
    );

    const repeated = repeatAudioBuffer(source, { count: 3 });
    const copy = repeatAudioBuffer(source, { count: 1 });

    expect(repeated.length).toBe(6);
    expect(repeated.numberOfChannels).toBe(2);
    expect(Array.from(repeated.getChannelData(0))).toEqual([1, 0, 1, 0, 1, 0]);
    expect(Array.from(repeated.getChannelData(1))).toEqual([0, 1, 0, 1, 0, 1]);
    expect(copy).not.toBe(source);
    expect(Array.from(source.getChannelData(0))).toEqual([1, 0]);
  });

  it("repeats AudioBuffers with crossfaded joins", () => {
    const source = createAudioBufferFromChannels([[1, 1, 0, 0]], {
      sampleRate: 10,
    });

    const repeated = repeatAudioBuffer(source, { count: 2, crossFade: 0.2 });

    expect(repeated.length).toBe(6);
    expect(Array.from(repeated.getChannelData(0))).toEqual([1, 1, 0, 1, 0, 0]);
  });

  it("validates AudioBuffer repeat inputs", () => {
    const context = createMockContext();
    const source = createAudioBufferFromChannels([[1]], { sampleRate: context.sampleRate });

    expect(() => repeatAudioBuffer(source, { count: 0 })).toThrow(RangeError);
    expect(() => repeatAudioBuffer(source, { count: 2, crossFade: -1 })).toThrow(RangeError);
  });

  it("creates repeated AudioBuffer loops from a time range", () => {
    const source = createAudioBufferFromChannels(
      [
        [0, 1, 2, 3, 4],
        [5, 4, 3, 2, 1],
      ],
      {
        sampleRate: 10,
      },
    );

    const loop = createAudioBufferLoop(source, {
      end: 0.4,
      repetitions: 2,
      start: 0.1,
    });

    expect(loop.length).toBe(6);
    expect(loop.numberOfChannels).toBe(2);
    expect(loop.sampleRate).toBe(10);
    expect(Array.from(loop.getChannelData(0))).toEqual([1, 2, 3, 1, 2, 3]);
    expect(Array.from(loop.getChannelData(1))).toEqual([4, 3, 2, 4, 3, 2]);
    expect(Array.from(source.getChannelData(0))).toEqual([0, 1, 2, 3, 4]);
  });

  it("creates AudioBuffer loops with crossfaded repetitions", () => {
    const source = createAudioBufferFromChannels([[1, 1, 0, 0]], {
      sampleRate: 10,
    });

    const loop = createAudioBufferLoop(source, {
      crossFade: 0.2,
      repetitions: 2,
    });

    expect(loop.length).toBe(6);
    expect(Array.from(loop.getChannelData(0))).toEqual([1, 1, 0, 1, 0, 0]);
  });

  it("validates AudioBuffer loop inputs", () => {
    const source = createAudioBufferFromChannels([[0, 1, 2]], {
      sampleRate: 10,
    });

    expect(() => createAudioBufferLoop(source, { repetitions: 0 })).toThrow(RangeError);
    expect(() => createAudioBufferLoop(source, { start: 0.2, end: 0.1 })).toThrow(RangeError);
    expect(() => createAudioBufferLoop(source, { crossFade: -1 })).toThrow(RangeError);
  });

  it("replaces AudioBuffer time ranges without mutating the source", () => {
    const source = createAudioBufferFromChannels(
      [
        [0, 1, 2, 3, 4],
        [5, 4, 3, 2, 1],
      ],
      {
        sampleRate: 10,
      },
    );

    const replacement = createAudioBufferFromChannels(
      [
        [8, 9],
        [9, 8],
      ],
      {
        sampleRate: 10,
      },
    );

    const replaced = replaceAudioBufferRange(source, replacement, {
      end: 0.4,
      start: 0.1,
    });

    expect(replaced.length).toBe(4);
    expect(replaced.numberOfChannels).toBe(2);
    expect(Array.from(replaced.getChannelData(0))).toEqual([0, 8, 9, 4]);
    expect(Array.from(replaced.getChannelData(1))).toEqual([5, 9, 8, 1]);
    expect(Array.from(source.getChannelData(0))).toEqual([0, 1, 2, 3, 4]);
  });

  it("deletes AudioBuffer ranges and joins the rest", () => {
    const source = createAudioBufferFromChannels(
      [
        [0, 1, 2, 3],
        [4, 5, 6, 7],
      ],
      { sampleRate: 10 },
    );

    const middle = deleteAudioBufferRange(source, { end: 0.3, start: 0.1 });
    const tail = deleteAudioBufferRange(source, { start: 0.2 });

    expect(Array.from(middle.getChannelData(0))).toEqual([0, 3]);
    expect(Array.from(middle.getChannelData(1))).toEqual([4, 7]);
    expect(Array.from(tail.getChannelData(0))).toEqual([0, 1]);
    expect(Array.from(source.getChannelData(0))).toEqual([0, 1, 2, 3]);
    expect(() => deleteAudioBufferRange(source)).toThrow(RangeError);
    expect(() => deleteAudioBufferRange(source, { end: 0.1, start: 0.2 })).toThrow(RangeError);
  });

  it("inserts an AudioBuffer at an empty range", () => {
    const source = createAudioBufferFromChannels([[0, 1, 2]], { sampleRate: 10 });
    const insert = createAudioBufferFromChannels([[8, 9]], { sampleRate: 10 });

    const inserted = replaceAudioBufferRange(source, insert, { end: 0.1, start: 0.1 });

    expect(Array.from(inserted.getChannelData(0))).toEqual([0, 8, 9, 1, 2]);
  });

  it("validates AudioBuffer range replacement inputs", () => {
    const source = createAudioBufferFromChannels([[0]], { sampleRate: 10 });
    const differentRate = createAudioBufferFromChannels([[1]], { sampleRate: 20 });

    const differentChannels = createAudioBufferFromChannels([[1], [2]], {
      sampleRate: 10,
    });

    expect(() => replaceAudioBufferRange(source, differentRate)).toThrow(RangeError);
    expect(() => replaceAudioBufferRange(source, differentChannels)).toThrow(RangeError);
    expect(() => replaceAudioBufferRange(source, source, { start: 0.2, end: 0.1 })).toThrow(
      RangeError,
    );
  });

  it("silences AudioBuffer ranges without changing length or mutating the source", () => {
    const source = createAudioBufferFromChannels(
      [
        [0, 1, 2, 3],
        [4, 5, 6, 7],
      ],
      {
        sampleRate: 10,
      },
    );

    const silenced = silenceAudioBufferRange(source, { start: 0.1, end: 0.3 });

    expect(silenced.length).toBe(4);
    expect(Array.from(silenced.getChannelData(0))).toEqual([0, 0, 0, 3]);
    expect(Array.from(silenced.getChannelData(1))).toEqual([4, 0, 0, 7]);
    expect(Array.from(source.getChannelData(0))).toEqual([0, 1, 2, 3]);
  });

  it("handles and validates AudioBuffer silence ranges", () => {
    const source = createAudioBufferFromChannels([[1, 2]], { sampleRate: 10 });

    const unchanged = silenceAudioBufferRange(source, { start: 0.3, end: 0.5 });

    expect(Array.from(unchanged.getChannelData(0))).toEqual([1, 2]);
    expect(() => silenceAudioBufferRange(source, { start: 0.2, end: 0.1 })).toThrow(RangeError);
  });

  it("solos AudioBuffer ranges without changing length or mutating the source", () => {
    const source = createAudioBufferFromChannels(
      [
        [0, 1, 2, 3],
        [4, 5, 6, 7],
      ],
      {
        sampleRate: 10,
      },
    );

    const soloed = soloAudioBufferRange(source, { start: 0.1, end: 0.3 });

    expect(soloed.length).toBe(4);
    expect(Array.from(soloed.getChannelData(0))).toEqual([0, 1, 2, 0]);
    expect(Array.from(soloed.getChannelData(1))).toEqual([0, 5, 6, 0]);
    expect(Array.from(source.getChannelData(0))).toEqual([0, 1, 2, 3]);
  });

  it("handles and validates AudioBuffer solo ranges", () => {
    const source = createAudioBufferFromChannels([[1, 2]], { sampleRate: 10 });

    const empty = soloAudioBufferRange(source, { start: 0.3, end: 0.5 });

    expect(Array.from(empty.getChannelData(0))).toEqual([0, 0]);
    expect(() => soloAudioBufferRange(source, { start: 0.2, end: 0.1 })).toThrow(RangeError);
  });

  it("pads AudioBuffers with leading and trailing silence", () => {
    const source = createAudioBufferFromChannels(
      [
        [1, 0.5],
        [0.25, -0.25],
      ],
      {
        sampleRate: 10,
      },
    );

    const padded = padAudioBuffer(source, { before: 0.2, after: 0.1 });

    expect(padded).not.toBe(source);
    expect(padded.length).toBe(5);
    expect(padded.numberOfChannels).toBe(2);
    expect(padded.sampleRate).toBe(10);
    expect(Array.from(padded.getChannelData(0))).toEqual([0, 0, 1, 0.5, 0]);
    expect(Array.from(padded.getChannelData(1))).toEqual([0, 0, 0.25, -0.25, 0]);
    expect(Array.from(source.getChannelData(0))).toEqual([1, 0.5]);
  });

  it("validates AudioBuffer padding durations", () => {
    const source = createAudioBufferFromChannels([[1]], { sampleRate: 10 });

    expect(() => padAudioBuffer(source, { before: -1 })).toThrow(RangeError);
  });

  it("shifts AudioBuffers by second-based offsets without changing length", () => {
    const source = createAudioBufferFromChannels(
      [
        [1, 2, 3, 4],
        [5, 6, 7, 8],
      ],
      {
        sampleRate: 10,
      },
    );

    const delayed = shiftAudioBuffer(source, { offset: 0.2 });
    const advanced = shiftAudioBuffer(source, { offset: -0.1 });

    expect(delayed.length).toBe(4);
    expect(Array.from(delayed.getChannelData(0))).toEqual([0, 0, 1, 2]);
    expect(Array.from(delayed.getChannelData(1))).toEqual([0, 0, 5, 6]);
    expect(Array.from(advanced.getChannelData(0))).toEqual([2, 3, 4, 0]);
    expect(Array.from(advanced.getChannelData(1))).toEqual([6, 7, 8, 0]);
    expect(Array.from(source.getChannelData(0))).toEqual([1, 2, 3, 4]);
  });

  it("handles and validates AudioBuffer shift offsets", () => {
    const source = createAudioBufferFromChannels([[1, 2]], { sampleRate: 10 });
    const beyond = shiftAudioBuffer(source, { offset: 0.2 });

    expect(Array.from(beyond.getChannelData(0))).toEqual([0, 0]);
    expect(() => shiftAudioBuffer(source, { offset: 0.05 })).toThrow(RangeError);
  });

  it("resizes AudioBuffers by truncating or padding with silence", () => {
    const source = createAudioBufferFromChannels(
      [
        [1, 2, 3],
        [4, 5, 6],
      ],
      {
        sampleRate: 10,
      },
    );

    const truncated = resizeAudioBuffer(source, { length: 2 });
    const padded = resizeAudioBuffer(source, { length: 5 });

    expect(truncated.length).toBe(2);
    expect(truncated.numberOfChannels).toBe(2);
    expect(truncated.sampleRate).toBe(10);
    expect(Array.from(truncated.getChannelData(0))).toEqual([1, 2]);
    expect(Array.from(truncated.getChannelData(1))).toEqual([4, 5]);
    expect(Array.from(padded.getChannelData(0))).toEqual([1, 2, 3, 0, 0]);
    expect(Array.from(padded.getChannelData(1))).toEqual([4, 5, 6, 0, 0]);
    expect(Array.from(source.getChannelData(0))).toEqual([1, 2, 3]);
  });

  it("resizes AudioBuffers from duration and validates resize options", () => {
    const source = createAudioBufferFromChannels([[1, 2, 3]], { sampleRate: 10 });

    const byDuration = resizeAudioBuffer(source, { duration: 0.2 });
    expect(Array.from(byDuration.getChannelData(0))).toEqual([1, 2]);
    // Web Audio has no empty buffers.
    expect(() => resizeAudioBuffer(source, { length: 0 })).toThrow(RangeError);
    expect(() => resizeAudioBuffer(source, { duration: 0.1, length: 1 })).toThrow(RangeError);
    expect(() => resizeAudioBuffer(source, { duration: 0.25 })).toThrow(RangeError);
  });

  it("rotates AudioBuffers by second-based offsets without mutating the source", () => {
    const source = createAudioBufferFromChannels(
      [
        [1, 2, 3, 4],
        [5, 6, 7, 8],
      ],
      {
        sampleRate: 10,
      },
    );

    const delayed = rotateAudioBuffer(source, { offset: 0.1 });
    const advanced = rotateAudioBuffer(source, { offset: -0.2 });

    expect(delayed.length).toBe(4);
    expect(Array.from(delayed.getChannelData(0))).toEqual([4, 1, 2, 3]);
    expect(Array.from(delayed.getChannelData(1))).toEqual([8, 5, 6, 7]);
    expect(Array.from(advanced.getChannelData(0))).toEqual([3, 4, 1, 2]);
    expect(Array.from(advanced.getChannelData(1))).toEqual([7, 8, 5, 6]);
    expect(Array.from(source.getChannelData(0))).toEqual([1, 2, 3, 4]);
  });

  it("handles and validates AudioBuffer rotate offsets", () => {
    const source = createAudioBufferFromChannels([[1, 2, 3]], { sampleRate: 10 });
    const unchanged = rotateAudioBuffer(source, { offset: 0.3 });

    expect(Array.from(unchanged.getChannelData(0))).toEqual([1, 2, 3]);
    expect(() => rotateAudioBuffer(source, { offset: 0.05 })).toThrow(RangeError);
  });

  it("slices buffers with second-based offsets", () => {
    const source = createAudioBufferFromChannels([[0, 1, 2, 3, 4, 5]], {
      sampleRate: 10,
    });

    const sliced = sliceAudioBuffer(source, {
      start: 0.2,
      end: 0.5,
    });

    expect(sliced.length).toBe(3);
    expect(sliced.duration).toBe(0.3);
    expect(Array.from(sliced.getChannelData(0))).toEqual([2, 3, 4]);
  });

  it("extends slices beyond the source with silence", () => {
    const source = createAudioBufferFromChannels([[0, 1, 2]], {
      sampleRate: 10,
    });

    const extended = sliceAudioBuffer(source, {
      start: 0.1,
      end: 0.5,
    });

    const silence = sliceAudioBuffer(source, {
      start: 0.4,
      end: 0.6,
    });

    expect(extended.length).toBe(4);
    expect(Array.from(extended.getChannelData(0))).toEqual([1, 2, 0, 0]);
    expect(silence.length).toBe(2);
    expect(Array.from(silence.getChannelData(0))).toEqual([0, 0]);
  });

  it("rejects invalid slice ranges", () => {
    const source = createAudioBufferFromChannels([[0, 1, 2]], {
      sampleRate: 10,
    });

    expect(() => sliceAudioBuffer(source, { start: 0.2, end: 0.2 })).toThrow(RangeError);
    expect(() => sliceAudioBuffer(source, { start: 0.3, end: 0.2 })).toThrow(RangeError);
  });

  it("rejects non-frame-aligned second-based buffer edits", () => {
    const source = createAudioBufferFromChannels([[0, 1, 2]], { sampleRate: 10 });
    const replacement = createAudioBufferFromChannels([[9]], { sampleRate: 10 });

    expect(() => sliceAudioBuffer(source, { start: 0.05, end: 0.2 })).toThrow(RangeError);
    expect(() => replaceAudioBufferRange(source, replacement, { start: 0.05 })).toThrow(RangeError);
    expect(() => silenceAudioBufferRange(source, { start: 0.05 })).toThrow(RangeError);
    expect(() => soloAudioBufferRange(source, { start: 0.05 })).toThrow(RangeError);
    expect(() => shiftAudioBuffer(source, { offset: 0.05 })).toThrow(RangeError);
    expect(() => rotateAudioBuffer(source, { offset: 0.05 })).toThrow(RangeError);
    expect(() => resizeAudioBuffer(source, { duration: 0.25 })).toThrow(RangeError);
    expect(() => fadeAudioBuffer(source, { fadeIn: 0.05 })).toThrow(RangeError);
    expect(() => padAudioBuffer(source, { before: 0.05 })).toThrow(RangeError);
  });

  it("accepts aligned times that floating point puts slightly off a frame", () => {
    // `0.07 * 44_100` is `3087.0000000000005`, and `0.07 * 48_000` is `3360.0000000000005`.
    const source = createAudioBufferFromChannels([new Float32Array(48_000)], {
      sampleRate: 44_100,
    });

    expect(sliceAudioBuffer(source, { start: 0.07, end: 0.14 }).length).toBe(3087);
    // The default end, `duration * sampleRate`, is `48000.00000000001` here.
    expect(sliceAudioBuffer(source, { start: 0.07 }).length).toBe(48_000 - 3087);
    expect(shiftAudioBuffer(source, { offset: -0.07 }).length).toBe(48_000);
    expect(resizeAudioBuffer(source, { duration: 0.07 }).length).toBe(3087);
    expect(padAudioBuffer(source, { before: 0.07 }).length).toBe(48_000 + 3087);
  });
});
