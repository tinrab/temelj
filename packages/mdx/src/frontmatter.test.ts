import { describe, expect, expectTypeOf, it } from "vitest";

import {
  compile,
  documentFrontmatter,
  formatHtml,
  formatMdx,
  lowerHtml,
  MdxStream,
  parse,
  SourceFile,
  type FrontmatterNode,
  type FrontmatterTemporal,
  type FrontmatterObject,
  type FrontmatterValue,
} from "./mod.ts";

describe("frontmatter", () => {
  it("is opt-in and selects formats by the opening fence", () => {
    expect(documentFrontmatter(parse("---\ntitle: disabled\n---").document)).toBeUndefined();

    const yaml = parse("---\ntitle: YAML\n---", { syntax: { frontmatter: "auto" } });

    const toml = parse('+++\ntitle = "TOML"\n+++', { syntax: { frontmatter: "auto" } });

    expect(documentFrontmatter(yaml.document)?.format).toBe("yaml");
    expect(documentFrontmatter(yaml.document)?.data).toEqual({ title: "YAML" });
    expect(documentFrontmatter(toml.document)?.format).toBe("toml");
    expect(documentFrontmatter(toml.document)?.data).toEqual({ title: "TOML" });

    expect(
      documentFrontmatter(
        parse('+++\ntitle = "excluded"\n+++', { syntax: { frontmatter: "yaml" } }).document,
      ),
    ).toBeUndefined();
    expect(
      documentFrontmatter(
        parse("---\ntitle: excluded\n---", { syntax: { frontmatter: "toml" } }).document,
      ),
    ).toBeUndefined();
    expect(
      documentFrontmatter(
        parse("---\ntitle: open\n+++", { syntax: { frontmatter: "auto" } }).document,
      ),
    ).toBeUndefined();
    expect(
      documentFrontmatter(
        parse("--- \t\ntitle: spaced\n---\t ", { syntax: { frontmatter: "yaml" } }).document,
      )?.data,
    ).toEqual({ title: "spaced" });
  });

  it("decodes owned YAML values and preserves integer precision", () => {
    const source = [
      "---",
      "title: Notes",
      "published: true",
      "draft: null",
      "safe: 42",
      "unsafe: 9007199254740993",
      "date: 2026-08-26",
      "nested:",
      "  tags: [one, two]",
      "---",
    ].join("\n");

    const data = documentFrontmatter(
      parse(source, { syntax: { frontmatter: "yaml" } }).document,
    )?.data;

    expect(data).toEqual({
      title: "Notes",
      published: true,
      draft: null,
      safe: 42,
      unsafe: 9_007_199_254_740_993n,
      date: "2026-08-26",
      nested: { tags: ["one", "two"] },
    });
  });

  it("keeps prototype-looking keys as ordinary metadata", () => {
    const data = documentFrontmatter(
      parse("---\n__proto__: safe\nconstructor: ordinary\n---", {
        syntax: { frontmatter: "yaml" },
      }).document,
    )?.data;

    expect(data?.__proto__).toBe("safe");
    expect(data?.constructor).toBe("ordinary");
    expect(data === undefined ? false : Object.hasOwn(data, "__proto__")).toBe(true);
  });

  it("treats empty and comment-only YAML as an empty object", () => {
    expect(
      documentFrontmatter(parse("---\n---", { syntax: { frontmatter: "yaml" } }).document)?.data,
    ).toEqual({});
    expect(
      documentFrontmatter(
        parse("---\n# comment\n---", { syntax: { frontmatter: "yaml" } }).document,
      )?.data,
    ).toEqual({});
  });

  it("preserves TOML non-finite numbers, BigInts, and temporal kinds", () => {
    const source = [
      "+++",
      "safe = 42",
      "unsafe = 9007199254740993",
      "nan = nan",
      "positive = inf",
      "negative = -inf",
      "offset = 1979-05-27T07:32:00-08:00",
      "local_datetime = 1979-05-27T07:32:00",
      "local_date = 1979-05-27",
      "local_time = 07:32:00",
      "+++",
    ].join("\n");

    const data = documentFrontmatter(
      parse(source, { syntax: { frontmatter: "toml" } }).document,
    )?.data;

    expect(data?.safe).toBe(42);
    expect(data?.unsafe).toBe(9_007_199_254_740_993n);
    expect(data?.nan).toBeNaN();
    expect(data?.positive).toBe(Infinity);
    expect(data?.negative).toBe(-Infinity);
    expect(data?.offset).toEqual({
      kind: "temporal",
      type: "offset-date-time",
      value: "1979-05-27T07:32:00.000-08:00",
    });
    expect(data?.local_datetime).toEqual({
      kind: "temporal",
      type: "local-date-time",
      value: "1979-05-27T07:32:00.000",
    });
    expect(data?.local_date).toEqual({ kind: "temporal", type: "local-date", value: "1979-05-27" });
    expect(data?.local_time).toEqual({
      kind: "temporal",
      type: "local-time",
      value: "07:32:00.000",
    });
  });

  it("rejects non-mapping roots, duplicate keys, and invalid syntax", () => {
    for (const source of ["---\nvalue\n---", "---\n- value\n---"]) {
      expect(() => parse(source, { syntax: { frontmatter: "yaml" } })).toThrow(
        expect.objectContaining({
          diagnostics: [expect.objectContaining({ code: "mdx.frontmatter.root" })],
        }),
      );
    }

    expect(() => parse("---\na: 1\na: 2\n---", { syntax: { frontmatter: "yaml" } })).toThrow(
      expect.objectContaining({
        diagnostics: [expect.objectContaining({ code: "mdx.frontmatter.yaml" })],
      }),
    );
    expect(() => parse("+++\na = [\n+++", { syntax: { frontmatter: "toml" } })).toThrow(
      expect.objectContaining({
        diagnostics: [expect.objectContaining({ code: "mdx.frontmatter.toml" })],
      }),
    );
  });

  it("clones aliases and rejects cyclic aliases", () => {
    const aliases = documentFrontmatter(
      parse("---\nbase: &base { value: 1 }\ncopy: *base\n---", {
        syntax: { frontmatter: "yaml" },
      }).document,
    )?.data;

    expect(aliases?.base).toEqual({ value: 1 });
    expect(aliases?.copy).toEqual({ value: 1 });
    expect(aliases?.base).not.toBe(aliases?.copy);

    expect(() =>
      parse("---\nvalue: &value [*value]\n---", { syntax: { frontmatter: "yaml" } }),
    ).toThrow(
      expect.objectContaining({
        diagnostics: [expect.objectContaining({ code: "mdx.frontmatter.value" })],
      }),
    );
  });

  it("rejects unsupported YAML keys and tags and limits alias expansion", () => {
    expect(() => parse("---\n? [a, b]\n: value\n---", { syntax: { frontmatter: "yaml" } })).toThrow(
      expect.objectContaining({
        diagnostics: [expect.objectContaining({ code: "mdx.frontmatter.yaml" })],
      }),
    );
    expect(
      parse("---\nvalue: !custom test\n---", { syntax: { frontmatter: "yaml" } }).diagnostics,
    ).toMatchObject([{ code: "mdx.frontmatter.yaml", severity: "warning" }]);
    const references = Array.from({ length: 101 }, () => "*item").join(", ");
    expect(() =>
      parse(`---\nitem: &item [1]\nitems: [${references}]\n---`, {
        syntax: { frontmatter: "yaml" },
      }),
    ).toThrow(
      expect.objectContaining({
        diagnostics: [expect.objectContaining({ code: "mdx.frontmatter.yaml" })],
      }),
    );
  });

  it("maps parser errors into the shared UTF-16 source with CRLF", () => {
    const file = new SourceFile("---\r\nemoji: 😀\r\nbad: [\r\n---");
    expect(() => parse(file, { syntax: { frontmatter: "yaml" } })).toThrow(
      expect.objectContaining({
        file,
        diagnostics: [
          expect.objectContaining({ span: expect.objectContaining({ file, start: 22 }) }),
        ],
      }),
    );
    expect(file.location(22)).toEqual({ offset: 22, line: 3, column: 7 });
    const tomlFile = new SourceFile('+++\r\nemoji = "😀"\r\nbad = [\r\n+++');
    expect(() => parse(tomlFile, { syntax: { frontmatter: "toml" } })).toThrow(
      expect.objectContaining({
        diagnostics: [
          expect.objectContaining({
            span: expect.objectContaining({ file: tomlFile, start: tomlFile.text.indexOf("[") }),
          }),
        ],
      }),
    );
  });

  it("formats from the authored value", () => {
    const source = "---\n# keep this\nvalue: 1.0\n---";

    const node = documentFrontmatter(parse(source, { syntax: { frontmatter: "yaml" } }).document);

    expect(node?.kind).toBe("frontmatter");

    if (node === undefined) {
      return;
    }

    expect(formatMdx(node)).toBe(source);
    expect(
      documentFrontmatter(parse(formatMdx(node), { syntax: { frontmatter: "auto" } }).document)
        ?.value,
    ).toBe("# keep this\nvalue: 1.0");
  });

  it("omits frontmatter from HTML and compiled output", async () => {
    const parsed = parse("---\ntitle: Hidden\n---\n\n# Visible", {
      syntax: { frontmatter: "yaml" },
    });

    expect(formatHtml(lowerHtml(parsed.document))).not.toContain("Hidden");

    const compiled = await compile(parsed, { outputFormat: "program" });
    expect(compiled.artifact.code).not.toContain("Hidden");
  });

  it("decodes frontmatter when a stream completes", () => {
    const stream = new MdxStream({ syntax: { frontmatter: "yaml" } });
    const open = stream.append("---\nvalue: [");
    expect(open.diagnostics).toEqual([]);

    stream.edit({
      start: open.file.text.indexOf("["),
      end: open.file.text.length,
      text: "[]\n---",
    });
    const completed = stream.complete();

    expect(documentFrontmatter(completed.document)?.data).toEqual({ value: [] });
  });

  it("exports its recursive metadata types", () => {
    expectTypeOf<FrontmatterValue>().toMatchTypeOf<
      | null
      | boolean
      | number
      | bigint
      | string
      | FrontmatterTemporal
      | readonly FrontmatterValue[]
      | FrontmatterObject
    >();
    expectTypeOf<FrontmatterNode["data"]>().toEqualTypeOf<FrontmatterObject | undefined>();
  });
});
