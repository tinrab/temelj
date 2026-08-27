import { expect, expectTypeOf, test } from "vitest";

import { InputError } from "./errors.ts";
import { ParagraphNode, SourceFile, TextNode, type SourceSpan } from "./model.ts";

test("locates UTF-16 offsets across every CommonMark line ending", () => {
  const file = new SourceFile("a\r\nb\rc\nd\u{1F600}");

  expect(file.location(0)).toEqual({ offset: 0, line: 1, column: 1 });
  expect(file.location(3)).toEqual({ offset: 3, line: 2, column: 1 });
  expect(file.location(5)).toEqual({ offset: 5, line: 3, column: 1 });
  expect(file.location(7)).toEqual({ offset: 7, line: 4, column: 1 });
  expect(file.location(10)).toEqual({ offset: 10, line: 4, column: 4 });
  expect(() => file.location(11)).toThrow(InputError);
});

test("retains atomic source provenance", () => {
  const file = new SourceFile("text");
  const node = new TextNode("text", { file, start: 0, end: 4 });

  expect(node.sourceText()).toBe("text");
  expectTypeOf<SourceSpan>().toEqualTypeOf<{
    readonly file: SourceFile;
    readonly start: number;
    readonly end: number;
  }>();
  expectTypeOf(node.origin).toEqualTypeOf<Readonly<SourceSpan> | undefined>();
});

test("reuses nodes only when replacement children retain identity", () => {
  const paragraph = new ParagraphNode([new TextNode("text")]);

  expect(paragraph.with({ children: paragraph.children })).toBe(paragraph);
  expect(paragraph.with({ children: [new TextNode("text")] })).not.toBe(paragraph);
  expect(paragraph.with({ children: [new TextNode("changed")] })).not.toBe(paragraph);
});
