import { describe, expect, expectTypeOf, it } from "vitest";

import {
  compile,
  documentFrontmatter,
  formatHtml,
  formatMdx,
  lowerHtml,
  MdxStream,
  parse,
  type FrontmatterNode,
  type FrontmatterTemporal,
  type FrontmatterObject,
  type FrontmatterValue,
} from "./mod.ts";

describe("frontmatter", () => {
  it("is opt-in and selects formats by the opening fence", () => {
    expect(
      documentFrontmatter(expectParsed(parse("---\ntitle: disabled\n---")).document),
    ).toBeUndefined();

    const yaml = expectParsed(parse("---\ntitle: YAML\n---", { syntax: { frontmatter: "auto" } }));

    const toml = expectParsed(
      parse('+++\ntitle = "TOML"\n+++', { syntax: { frontmatter: "auto" } }),
    );

    expect(documentFrontmatter(yaml.document)?.format).toBe("yaml");
    expect(documentFrontmatter(yaml.document)?.data).toEqual({ title: "YAML" });
    expect(documentFrontmatter(toml.document)?.format).toBe("toml");
    expect(documentFrontmatter(toml.document)?.data).toEqual({ title: "TOML" });

    expect(
      documentFrontmatter(
        expectParsed(parse('+++\ntitle = "excluded"\n+++', { syntax: { frontmatter: "yaml" } }))
          .document,
      ),
    ).toBeUndefined();
    expect(
      documentFrontmatter(
        expectParsed(parse("---\ntitle: excluded\n---", { syntax: { frontmatter: "toml" } }))
          .document,
      ),
    ).toBeUndefined();
    expect(
      documentFrontmatter(
        expectParsed(parse("---\ntitle: open\n+++", { syntax: { frontmatter: "auto" } })).document,
      ),
    ).toBeUndefined();
    expect(
      documentFrontmatter(
        expectParsed(parse("--- \t\ntitle: spaced\n---\t ", { syntax: { frontmatter: "yaml" } }))
          .document,
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
      expectParsed(parse(source, { syntax: { frontmatter: "yaml" } })).document,
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
      expectParsed(
        parse("---\n__proto__: safe\nconstructor: ordinary\n---", {
          syntax: { frontmatter: "yaml" },
        }),
      ).document,
    )?.data;

    expect(data?.__proto__).toBe("safe");
    expect(data?.constructor).toBe("ordinary");
    expect(data === undefined ? false : Object.hasOwn(data, "__proto__")).toBe(true);
  });

  it("treats empty and comment-only YAML as an empty object", () => {
    expect(
      documentFrontmatter(
        expectParsed(parse("---\n---", { syntax: { frontmatter: "yaml" } })).document,
      )?.data,
    ).toEqual({});
    expect(
      documentFrontmatter(
        expectParsed(parse("---\n# comment\n---", { syntax: { frontmatter: "yaml" } })).document,
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
      expectParsed(parse(source, { syntax: { frontmatter: "toml" } })).document,
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

    expect(documentFrontmatter(duplicate.document)?.data).toBeUndefined();
    expect(duplicate.diagnostics[0]?.code).toBe("mdx.frontmatter.yaml");

    const invalidToml = expectParsed(parse("+++\na = [\n+++", { syntax: { frontmatter: "toml" } }));
    expect(documentFrontmatter(invalidToml.document)?.value).toBe("a = [");
    expect(documentFrontmatter(invalidToml.document)?.data).toBeUndefined();
    expect(invalidToml.diagnostics[0]?.code).toBe("mdx.frontmatter.toml");
  });

  it("clones aliases and rejects cyclic aliases", () => {
    const aliases = documentFrontmatter(
      expectParsed(
        parse("---\nbase: &base { value: 1 }\ncopy: *base\n---", {
          syntax: { frontmatter: "yaml" },
        }),
      ).document,
    )?.data;

    expect(aliases?.base).toEqual({ value: 1 });
    expect(aliases?.copy).toEqual({ value: 1 });
    expect(aliases?.base).not.toBe(aliases?.copy);

    const cyclic = expectParsed(
      parse("---\nvalue: &value [*value]\n---", {
        syntax: { frontmatter: "yaml" },
      }),
    );

    expect(documentFrontmatter(cyclic.document)?.data).toBeUndefined();
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

    expect(documentFrontmatter(resource.document)?.data).toBeUndefined();
    expect(resource.diagnostics[0]?.code).toBe("mdx.frontmatter.yaml");
  });

  it("maps parser errors into the shared UTF-16 source with CRLF", () => {
    const source = "---\r\nemoji: 😀\r\nbad: [\r\n---";
    const report = expectParsed(parse(source, { syntax: { frontmatter: "yaml" } }));
    const diagnostic = report.diagnostics[0];
    expect(diagnostic?.span?.file).toBe(report.file);
    expect(
      diagnostic?.span === undefined
        ? undefined
        : diagnostic.span.file.location(diagnostic.span.start),
    ).toEqual({ offset: 22, line: 3, column: 7 });
    const valueOrigin = documentFrontmatter(report.document)?.valueOrigin;
    expect(valueOrigin === undefined ? undefined : report.file.slice(valueOrigin)).toBe(
      "emoji: 😀\r\nbad: [",
    );
    expect(documentFrontmatter(report.document)?.value).toBe("emoji: 😀\nbad: [");

    const tomlSource = '+++\r\nemoji = "😀"\r\nbad = [\r\n+++';
    const toml = expectParsed(parse(tomlSource, { syntax: { frontmatter: "toml" } }));
    const tomlSpan = toml.diagnostics[0]?.span;
    expect(tomlSpan === undefined ? undefined : tomlSpan.file.location(tomlSpan.start)).toEqual({
      offset: tomlSource.indexOf("["),
      line: 3,
      column: 7,
    });
  });

  it("formats from the authored value", () => {
    const source = "---\n# keep this\nvalue: 1.0\n---";

    const node = documentFrontmatter(
      expectParsed(parse(source, { syntax: { frontmatter: "yaml" } })).document,
    );

    expect(node?.kind).toBe("frontmatter");

    if (node === undefined) {
      return;
    }

    expect(formatMdx(node)).toBe(source);
    expect(
      documentFrontmatter(
        expectParsed(parse(formatMdx(node), { syntax: { frontmatter: "auto" } })).document,
      )?.value,
    ).toBe("# keep this\nvalue: 1.0");
  });

  it("omits frontmatter from HTML and compiled output", async () => {
    const parsed = expectParsed(
      parse("---\ntitle: Hidden\n---\n\n# Visible", {
        syntax: { frontmatter: "yaml" },
      }),
    );

    expect(formatHtml(lowerHtml(parsed.document))).not.toContain("Hidden");

    const compiled = await compile(parsed, { outputFormat: "program" });
    expect(compiled.kind === "ok" ? compiled.artifact.code : "").not.toContain("Hidden");
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
    expect(completed.kind).toBe("ok");

    if (completed.kind !== "ok") {
      throw new Error(`Expected parsed outcome, received ${completed.kind}`);
    }

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

function expectParsed(
  outcome: ReturnType<typeof parse>,
): Extract<ReturnType<typeof parse>, { kind: "ok" }> {
  if (outcome.kind !== "ok") {
    throw new Error(`Expected parsed outcome, received ${outcome.kind}`);
  }

  return outcome;
}
