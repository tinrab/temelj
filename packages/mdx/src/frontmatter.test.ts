import { describe, expect, expectTypeOf, it } from "vitest";

import {
  FrontmatterNode,
  FrontmatterTemporal,
  MdxStream,
  compile,
  parse,
  renderHtml,
  type FrontmatterObject,
  type FrontmatterValue,
} from "./mod.ts";

describe("frontmatter", () => {
  it("is opt-in and selects formats by the opening fence", () => {
    expect(expectParsed(parse("---\ntitle: disabled\n---")).document.frontmatter).toBeUndefined();

    const yaml = expectParsed(parse("---\ntitle: YAML\n---", { syntax: { frontmatter: "auto" } }));
    const toml = expectParsed(
      parse('+++\ntitle = "TOML"\n+++', { syntax: { frontmatter: "auto" } }),
    );
    expect(yaml.document.frontmatter?.format).toBe("yaml");
    expect(yaml.document.frontmatter?.data).toEqual({ title: "YAML" });
    expect(toml.document.frontmatter?.format).toBe("toml");
    expect(toml.document.frontmatter?.data).toEqual({ title: "TOML" });

    expect(
      expectParsed(parse('+++\ntitle = "excluded"\n+++', { syntax: { frontmatter: "yaml" } }))
        .document.frontmatter,
    ).toBeUndefined();
    expect(
      expectParsed(parse("---\ntitle: excluded\n---", { syntax: { frontmatter: "toml" } })).document
        .frontmatter,
    ).toBeUndefined();
    expect(
      expectParsed(parse("---\ntitle: open\n+++", { syntax: { frontmatter: "auto" } })).document
        .frontmatter,
    ).toBeUndefined();
    expect(
      expectParsed(parse("--- \t\ntitle: spaced\n---\t ", { syntax: { frontmatter: "yaml" } }))
        .document.frontmatter?.data,
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
    const data = expectParsed(parse(source, { syntax: { frontmatter: "yaml" } })).document
      .frontmatter?.data;

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
    const data = expectParsed(
      parse("---\n__proto__: safe\nconstructor: ordinary\n---", {
        syntax: { frontmatter: "yaml" },
      }),
    ).document.frontmatter?.data;
    expect(data?.__proto__).toBe("safe");
    expect(data?.constructor).toBe("ordinary");
    expect(data === undefined ? false : Object.hasOwn(data, "__proto__")).toBe(true);
  });

  it("treats empty and comment-only YAML as an empty object", () => {
    expect(
      expectParsed(parse("---\n---", { syntax: { frontmatter: "yaml" } })).document.frontmatter
        ?.data,
    ).toEqual({});
    expect(
      expectParsed(parse("---\n# comment\n---", { syntax: { frontmatter: "yaml" } })).document
        .frontmatter?.data,
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
    const data = expectParsed(parse(source, { syntax: { frontmatter: "toml" } })).document
      .frontmatter?.data;
    expect(data?.safe).toBe(42);
    expect(data?.unsafe).toBe(9_007_199_254_740_993n);
    expect(data?.nan).toBeNaN();
    expect(data?.positive).toBe(Infinity);
    expect(data?.negative).toBe(-Infinity);
    expect(data?.offset).toEqual(
      new FrontmatterTemporal("offset-date-time", "1979-05-27T07:32:00.000-08:00"),
    );
    expect(data?.local_datetime).toEqual(
      new FrontmatterTemporal("local-date-time", "1979-05-27T07:32:00.000"),
    );
    expect(data?.local_date).toEqual(new FrontmatterTemporal("local-date", "1979-05-27"));
    expect(data?.local_time).toEqual(new FrontmatterTemporal("local-time", "07:32:00.000"));
  });

  it("rejects non-mapping roots, duplicate keys, and invalid syntax without dropping nodes", () => {
    for (const source of ["---\nvalue\n---", "---\n- value\n---"]) {
      expect(
        expectParsed(parse(source, { syntax: { frontmatter: "yaml" } })).diagnostics[0]?.code,
      ).toBe("mdx.frontmatter.root");
    }

    const duplicate = expectParsed(
      parse("---\na: 1\na: 2\n---", {
        syntax: { frontmatter: "yaml" },
      }),
    );
    expect(duplicate.document.frontmatter?.data).toBeUndefined();
    expect(duplicate.diagnostics[0]?.code).toBe("mdx.frontmatter.yaml");

    const invalidToml = expectParsed(parse("+++\na = [\n+++", { syntax: { frontmatter: "toml" } }));
    expect(invalidToml.document.frontmatter?.value).toBe("a = [");
    expect(invalidToml.document.frontmatter?.data).toBeUndefined();
    expect(invalidToml.diagnostics[0]?.code).toBe("mdx.frontmatter.toml");
  });

  it("clones aliases and rejects cyclic aliases", () => {
    const aliases = expectParsed(
      parse("---\nbase: &base { value: 1 }\ncopy: *base\n---", {
        syntax: { frontmatter: "yaml" },
      }),
    ).document.frontmatter?.data;
    expect(aliases?.base).toEqual({ value: 1 });
    expect(aliases?.copy).toEqual({ value: 1 });
    expect(aliases?.base).not.toBe(aliases?.copy);

    const cyclic = expectParsed(
      parse("---\nvalue: &value [*value]\n---", {
        syntax: { frontmatter: "yaml" },
      }),
    );
    expect(cyclic.document.frontmatter?.data).toBeUndefined();
    expect(cyclic.diagnostics.some(({ code }) => code === "mdx.frontmatter.value")).toBe(true);
  });

  it("rejects unsupported YAML keys and tags and limits alias expansion", () => {
    for (const body of ["? [a, b]\n: value", "value: !custom test"]) {
      expect(
        expectParsed(parse(`---\n${body}\n---`, { syntax: { frontmatter: "yaml" } })).diagnostics[0]
          ?.code,
      ).toBe("mdx.frontmatter.yaml");
    }

    const references = Array.from({ length: 101 }, () => "*item").join(", ");
    const resource = expectParsed(
      parse(`---\nitem: &item [1]\nitems: [${references}]\n---`, {
        syntax: { frontmatter: "yaml" },
      }),
    );
    expect(resource.document.frontmatter?.data).toBeUndefined();
    expect(resource.diagnostics[0]?.code).toBe("mdx.frontmatter.yaml");
  });

  it("maps parser errors into the shared UTF-16 source with CRLF", () => {
    const source = "---\r\nemoji: 😀\r\nbad: [\r\n---";
    const report = expectParsed(parse(source, { syntax: { frontmatter: "yaml" } }));
    const diagnostic = report.diagnostics[0];
    expect(diagnostic?.span?.file).toBe(report.document.origin?.file);
    expect(
      diagnostic?.span === undefined
        ? undefined
        : diagnostic.span.file.location(diagnostic.span.start),
    ).toEqual({ offset: 22, line: 3, column: 7 });
    expect(report.document.frontmatter?.valueOrigin.file.text).toBe(source);
    expect(report.document.frontmatter?.value).toBe("emoji: 😀\nbad: [");

    const tomlSource = '+++\r\nemoji = "😀"\r\nbad = [\r\n+++';
    const toml = expectParsed(parse(tomlSource, { syntax: { frontmatter: "toml" } }));
    const tomlSpan = toml.diagnostics[0]?.span;
    expect(tomlSpan === undefined ? undefined : tomlSpan.file.location(tomlSpan.start)).toEqual({
      offset: 26,
      line: 3,
      column: 8,
    });
  });

  it("formats from authored text and clears decoded data after structural edits", () => {
    const source = "---\n# keep this\nvalue: 1.0\n---";
    const node = expectParsed(parse(source, { syntax: { frontmatter: "yaml" } })).document
      .frontmatter;
    expect(node).toBeInstanceOf(FrontmatterNode);
    if (node === undefined) {
      return;
    }
    expect(node.toSource()).toBe(source);
    expect(
      expectParsed(parse(node.toSource(), { syntax: { frontmatter: "auto" } })).document.frontmatter
        ?.value,
    ).toBe("# keep this\nvalue: 1.0");
    expect(node.with({})).toBe(node);
    expect(node.with({ value: "value: 2" }).data).toBeUndefined();
    expect(node.with({ format: "toml" }).data).toBeUndefined();
  });

  it("omits frontmatter from HTML and compiled output", () => {
    const document = expectParsed(
      parse("---\ntitle: Hidden\n---\n\n# Visible", {
        syntax: { frontmatter: "yaml" },
      }),
    ).document;
    expect(renderHtml(document).toHtml()).not.toContain("Hidden");
    expect(compile(document).code).not.toContain("Hidden");
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
    expect(completed.kind).toBe("parsed");
    if (completed.kind !== "parsed") {
      throw new Error(`Expected parsed outcome, received ${completed.kind}`);
    }
    expect(completed.document.frontmatter?.data).toEqual({ value: [] });
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

function expectParsed(
  outcome: ReturnType<typeof parse>,
): Extract<ReturnType<typeof parse>, { kind: "parsed" }> {
  if (outcome.kind !== "parsed") {
    throw new Error(`Expected parsed outcome, received ${outcome.kind}`);
  }
  return outcome;
}
