import { describe, expect, it } from "vitest";

import {
  centsToFrequencyRatio,
  frequencyRatioToCents,
  frequencyToNearestMidi,
  frequencyToNote,
  frequencyToMidi,
  harmonizeFrequency,
  harmonizeNote,
  isNoteName,
  intervalToFrequencyRatio,
  midiToFrequency,
  midiToNote,
  noteToFrequency,
  noteToMidi,
  transposeFrequency,
  transposeNote,
} from "../mod.ts";

describe("pitch conversion", () => {
  it("converts MIDI notes to frequency with A4=440 defaults", () => {
    expect(midiToFrequency(69)).toBe(440);
    expect(midiToFrequency(60)).toBeCloseTo(261.6255653005986, 12);
  });

  it("converts frequencies back to MIDI notes", () => {
    expect(frequencyToMidi(440)).toBe(69);
    expect(frequencyToMidi(261.6255653005986)).toBeCloseTo(60, 12);
    expect(frequencyToMidi(450)).toBeCloseTo(69.389, 3);
    expect(frequencyToNearestMidi(450)).toBe(69);
    expect(frequencyToNearestMidi(880)).toBe(81);
    expect(frequencyToNearestMidi(450)).toBe(69);
    expect(frequencyToMidi(450)).toBeCloseTo(69.389, 3);
  });

  it("supports custom reference tuning", () => {
    expect(midiToFrequency(69, { referenceFrequency: 432 })).toBe(432);
    expect(frequencyToMidi(432, { referenceFrequency: 432 })).toBe(69);
    expect(
      midiToFrequency(60, {
        referenceFrequency: 256,
        referenceMidi: 60,
      }),
    ).toBe(256);
  });

  it("converts equal-temperament intervals to frequency ratios", () => {
    expect(intervalToFrequencyRatio(12)).toBe(2);
    expect(intervalToFrequencyRatio(7)).toBeCloseTo(1.4983070768766815, 12);
    expect(intervalToFrequencyRatio(1, { divisions: 24 })).toBeCloseTo(2 ** (1 / 24), 12);
    expect(centsToFrequencyRatio(1200)).toBe(2);
    expect(centsToFrequencyRatio(50)).toBeCloseTo(2 ** (0.5 / 12), 12);
    expect(frequencyRatioToCents(2)).toBe(1200);
    expect(frequencyRatioToCents(2 ** (1 / 24), { divisions: 24 })).toBeCloseTo(100, 12);
  });

  it("converts note names to MIDI and frequency", () => {
    expect(noteToMidi("C4")).toBe(60);
    expect(noteToMidi("F#3")).toBe(54);
    expect(noteToMidi("Bb2")).toBe(46);
    expect(noteToMidi("Cbb4")).toBe(58);
    expect(noteToMidi("Dx4")).toBe(64);
    expect(noteToMidi("B#3")).toBe(60);
    expect(noteToFrequency("A4")).toBe(440);
    expect(noteToFrequency("C4")).toBeCloseTo(261.6255653005986, 12);
    expect(noteToMidi("C3", { middleCOctave: 3 })).toBe(60);
  });

  it("formats MIDI and frequency values as note names", () => {
    expect(midiToNote(60)).toBe("C4");
    expect(midiToNote(61)).toBe("C#4");
    expect(midiToNote(61, { accidental: "flat" })).toBe("Db4");
    expect(midiToNote(69)).toBe("A4");
    expect(midiToNote(60, { middleCOctave: 3 })).toBe("C3");
    expect(frequencyToNote(440)).toBe("A4");
    expect(frequencyToNote(noteToFrequency("C4"))).toBe("C4");
  });

  it("transposes and harmonizes note names", () => {
    expect(transposeFrequency(440, -12)).toBe(220);
    expect(harmonizeFrequency(440, [0, 12])).toEqual([440, 880]);
    expect(transposeNote("A4", 3)).toBe("C5");
    expect(transposeNote("C4", -1, { accidental: "flat" })).toBe("B3");
    expect(harmonizeNote("A4", [0, 3, 7])).toEqual(["A4", "C5", "E5"]);
  });

  it("rejects invalid conversion inputs", () => {
    expect(() => midiToFrequency(Number.NaN)).toThrow("midi");
    expect(() => midiToFrequency(69, { referenceFrequency: 0 })).toThrow("referenceFrequency");
    expect(() => frequencyToMidi(0)).toThrow("frequency");
    expect(() => intervalToFrequencyRatio(1, { divisions: 0 })).toThrow("divisions");
    expect(() => centsToFrequencyRatio(Number.NaN)).toThrow("cents");
    expect(() => frequencyRatioToCents(0)).toThrow("ratio");
    expect(() => transposeFrequency(0, 1)).toThrow("frequency");
    expect(() => noteToMidi("soon")).toThrow("note");
  });

  it("recognizes scientific pitch note names", () => {
    expect(isNoteName("C4")).toBe(true);
    expect(isNoteName("F#3")).toBe(true);
    expect(isNoteName("Cbb4")).toBe(true);
    expect(isNoteName("Dx4")).toBe(true);
    expect(isNoteName("H4")).toBe(false);
    expect(isNoteName(4)).toBe(false);
  });
});
