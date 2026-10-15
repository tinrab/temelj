import { expect, test } from "vitest";

import { formatMdx, nodeText, parse, selectMdx, type MdxNode, type SourceFile } from "./mod.ts";

function selectNodes<TKind extends MdxNode["kind"]>(root: MdxNode, kind: TKind) {
  return Array.from(selectMdx(root, kind), ({ node }) => node);
}

function selectNode<TKind extends MdxNode["kind"]>(root: MdxNode, kind: TKind) {
  return selectNodes(root, kind)[0];
}

test("materializes direct block syntax into owned nodes", () => {
  const result = parse("Title\n=====\n\n    const x = 1\n\n---");
  expect(Object.isFrozen(result.diagnostics)).toBe(true);
  expect(result.document.children.map((node) => node.kind)).toEqual([
    "heading",
    "codeBlock",
    "thematicBreak",
  ]);
  expect(formatMdx(result.document)).toBe(
    "# Title\n\n" +
      String.fromCodePoint(96).repeat(3) +
      "\nconst x = 1\n" +
      String.fromCodePoint(96).repeat(3) +
      "\n\n---",
  );
});

test("retains definitions, references, and non-JSX raw HTML in the owned model", () => {
  const result = parse(
    '[guide]: https://rabzelj.com "Guide"\n[logo]: /logo\n\n[Read][guide] and ![Logo][logo]\n\n<!-- raw -->',
  );

  const document = result.document;
  expect(selectNode(document, "definition")?.url).toBe("https://rabzelj.com");
  expect(selectNode(document, "linkReference")?.identifier).toBe("GUIDE");
  expect(selectNode(document, "imageReference")?.identifier).toBe("LOGO");
  expect(formatMdx(selectNode(document, "rawHtmlBlock"))).toBe("<!-- raw -->");
});

test("owns hard breaks and JSX with source provenance", () => {
  const source = "before\\\nafter <span>raw</span>";
  const result = parse(source);
  const hardBreak = selectNode(result.document, "hardBreak");
  const jsx = selectNode(result.document, "jsxTextElement");
  expect(sourceText(result.file, hardBreak)).toBe("\\\n");
  expect(sourceText(result.file, jsx)).toBe("<span>raw</span>");
  expect(formatMdx(result.document)).toBe("before\\\nafter <span>raw</span>");
});

test("retains full and collapsed reference spelling", () => {
  const result = parse("[id]: /id\n[b]: /b\n[c]: /c\n\n[a][id] [b][] [c]");
  const references = selectNodes(result.document, "linkReference");
  expect(references.map((reference) => reference.referenceKind)).toEqual([
    "full",
    "collapsed",
    "shortcut",
  ]);
  expect(references.map((reference) => formatMdx(reference))).toEqual(["[a][ID]", "[b][]", "[c]"]);
});

test("replaces NUL with the replacement character while retaining source offsets", () => {
  const result = parse("a\0b");
  expect(nodeText(result.document)).toBe("a\uFFFDb");
  expect(sourceText(result.file, result.document.children[0])).toBe("a\0b");
});

test("reads JSX attribute expressions with nested braces and quoted delimiters", () => {
  const result = parse('<A b={{ a: 1 }} s="a}b" {...rest} flag />\n');
  const element = result.document.children[0];

  expect(element?.kind === "jsxFlowElement" ? element.attributes : []).toMatchObject([
    { kind: "jsxAttribute", name: "b", value: { code: "{ a: 1 }" } },
    { kind: "jsxAttribute", name: "s", value: "a}b" },
    { kind: "jsxSpreadAttribute", code: "rest" },
    { kind: "jsxAttribute", name: "flag" },
  ]);
});

function sourceText(file: SourceFile, node: MdxNode | undefined): string | undefined {
  return node?.origin === undefined ? undefined : file.slice(node.origin);
}
