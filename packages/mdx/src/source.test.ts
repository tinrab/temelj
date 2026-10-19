import { describe, expect, it } from "vitest";

import { SourceBuffer, SourceFile } from "./mod.ts";
import { SourceText } from "./source-text.ts";

function lines(file: SourceFile): readonly unknown[] {
  return Array.from({ length: file.lineCount }, (_, index) => file.line(index + 1));
}

describe("source files", () => {
  it.each([1, 2, 3, 5])(
    "index appended files like fresh files with %i-character chunks",
    (size) => {
      const text = "one\r\ntwo\rthree\n\nfour\r\n\r\nfive";
      const buffer = new SourceBuffer({ text: "" });
      const versions: SourceFile[] = [];

      for (let offset = 0; offset < text.length; offset += size) {
        versions.push(buffer.append(text.slice(offset, offset + size)));
      }

      // Earlier versions read the shared index after later appends extended it.
      for (const version of versions) {
        const fresh = new SourceFile(version.text);
        expect(lines(version)).toEqual(lines(fresh));
        expect(version.location(version.text.length)).toEqual(fresh.location(fresh.text.length));
      }
    },
  );

  it("starts a new generation on replace", () => {
    const buffer = new SourceBuffer({ text: "a\nb" });
    const before = buffer.append("\nc");
    const replaced = buffer.replace(0, 1, "x\ny");
    const after = buffer.append("\nz");

    expect(before.isPrefixOf(replaced)).toBe(false);
    expect(replaced.isPrefixOf(after)).toBe(true);
    expect(lines(before)).toEqual(lines(new SourceFile(before.text)));
    expect(lines(after)).toEqual(lines(new SourceFile(after.text)));
  });
});

describe("source text", () => {
  it("reads appended chunks like one string", () => {
    const text = "alpha\nbeta $ gamma \\( delta\n".repeat(40);
    let chunked = SourceText.of("");

    for (let offset = 0; offset < text.length; offset += 7) {
      chunked = chunked.append(text.slice(offset, offset + 7));
    }

    expect(chunked.length).toBe(text.length);
    expect(chunked.toString()).toBe(text);

    for (const [start, end] of [
      [0, 3],
      [5, 40],
      [100, 101],
      [3, 900],
      [text.length - 5, text.length],
    ]) {
      expect(chunked.slice(start, end)).toBe(text.slice(start, end));
    }

    for (const offset of [0, 6, 7, 13, 500, text.length - 1, text.length, -1]) {
      expect(chunked.char(offset)).toBe(text[offset]);
    }

    for (const search of ["$", "\\(", "gamma", "\n"]) {
      for (const from of [0, 6, 50, 333]) {
        expect(chunked.indexOf(search, from)).toBe(text.indexOf(search, from));
      }

      expect(chunked.lastIndexOf(search)).toBe(text.lastIndexOf(search));
    }
  });

  it("keeps earlier texts unchanged after later appends", () => {
    const first = SourceText.of("one").append(" two");
    const second = first.append(" three");

    expect(first.toString()).toBe("one two");
    expect(second.toString()).toBe("one two three");
  });
});
