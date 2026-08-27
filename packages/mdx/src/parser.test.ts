import { expect, test } from "vitest";

import { parse, selectMdx, type MdxNode } from "./mod.ts";

function selectNodes<TKind extends MdxNode["kind"]>(root: MdxNode, kind: TKind) {
  return Array.from(selectMdx(root, kind), ({ node }) => node);
}

function selectNode<TKind extends MdxNode["kind"]>(root: MdxNode, kind: TKind) {
  return selectNodes(root, kind)[0];
}

test("materializes direct block syntax into owned nodes", () => {
  const result = expectParsed(parse("Title\n=====\n\n    const x = 1\n\n---"));
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.diagnostics)).toBe(true);
  expect(result.document.children.map((node) => node.kind)).toEqual([
    "heading",
    "codeBlock",
    "thematicBreak",
  ]);
  expect(result.document.toSource()).toBe(
    "# Title\n\n" +
      String.fromCodePoint(96).repeat(3) +
      "\nconst x = 1\n" +
      String.fromCodePoint(96).repeat(3) +
      "\n\n---",
  );
});

test("retains definitions, references, and non-JSX raw HTML in the owned model", () => {
  const result = expectParsed(
    parse(
      '[guide]: https://rabzelj.com "Guide"\n[logo]: /logo\n\n[Read][guide] and ![Logo][logo]\n\n<!-- raw -->',
    ),
  );
  const document = result.document;
  expect(selectNode(document, "definition")?.url).toBe("https://rabzelj.com");
  expect(selectNode(document, "linkReference")?.identifier).toBe("GUIDE");
  expect(selectNode(document, "imageReference")?.identifier).toBe("LOGO");
  expect(selectNode(document, "rawHtmlBlock")?.toSource()).toBe("<!-- raw -->");
});

test("owns hard breaks and JSX with source provenance", () => {
  const source = "before\\\nafter <span>raw</span>";
  const result = expectParsed(parse(source));
  const hardBreak = selectNode(result.document, "hardBreak");
  const jsx = selectNode(result.document, "jsxTextElement");
  expect(hardBreak?.sourceText()).toBe("\\\n");
  expect(jsx?.sourceText()).toBe("<span>raw</span>");
  expect(result.document.toSource()).toBe("before\\\nafter <span>raw</span>");
});

test("retains full and collapsed reference spelling", () => {
  const result = expectParsed(parse("[id]: /id\n[b]: /b\n[c]: /c\n\n[a][id] [b][] [c]"));
  const references = selectNodes(result.document, "linkReference");
  expect(references.map((reference) => reference.referenceKind)).toEqual([
    "full",
    "collapsed",
    "shortcut",
  ]);
  expect(references.map((reference) => reference.toSource())).toEqual(["[a][ID]", "[b][]", "[c]"]);
});

test("replaces NUL with the replacement character while retaining source offsets", () => {
  const result = expectParsed(parse("a\0b"));
  expect(result.document.toString()).toBe("a\uFFFDb");
  expect(result.document.children[0].sourceText()).toBe("a\0b");
});

function expectParsed(
  outcome: ReturnType<typeof parse>,
): Extract<ReturnType<typeof parse>, { kind: "parsed" }> {
  if (outcome.kind !== "parsed") {
    throw new Error(`Expected parsed outcome, received ${outcome.kind}`);
  }
  return outcome;
}
