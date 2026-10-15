import { expect, test } from "vitest";

import { InputError } from "./errors.ts";
import { indexDocument, nodeText, parse, SourceFile, type DocumentNode } from "./mod.ts";

test("locates UTF-16 offsets across every CommonMark line ending", () => {
  const file = new SourceFile("a\r\nb\rc\nd\u{1F600}");

  expect(file.location(0)).toEqual({ offset: 0, line: 1, column: 1 });
  expect(file.location(3)).toEqual({ offset: 3, line: 2, column: 1 });
  expect(file.location(5)).toEqual({ offset: 5, line: 3, column: 1 });
  expect(file.location(7)).toEqual({ offset: 7, line: 4, column: 1 });
  expect(file.location(10)).toEqual({ offset: 10, line: 4, column: 4 });
  expect(() => file.location(11)).toThrow(InputError);
});

test("parses into plain JSON-serializable data", () => {
  const parsed = parse("# Title\n\nSome *text* with [a link](/x).\n\n- [x] done");

  expect(JSON.parse(JSON.stringify(parsed.document))).toEqual(parsed.document);
  expect(parsed.document.children[0]).toEqual({
    kind: "heading",
    depth: 1,
    children: [{ kind: "text", value: "Title", origin: { start: 2, end: 7 } }],
    origin: { start: 0, end: 7 },
  });
});

test("reads semantic text and indexes the first definition per identifier", () => {
  const document: DocumentNode = {
    kind: "document",
    children: [
      {
        kind: "paragraph",
        children: [
          { kind: "text", value: "a " },
          { kind: "emphasis", children: [{ kind: "text", value: "b" }] },
        ],
      },
      { kind: "definition", identifier: "X", url: "/first" },
      { kind: "definition", identifier: "X", url: "/second" },
    ],
  };

  expect(nodeText(document)).toBe("a b\n\n\n\n");
  expect(indexDocument(document).definitions.get("X")?.url).toBe("/first");
});
