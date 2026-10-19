import type { Schema } from "@temelj/standard-schema";

import { ss, StandardSchemaAsyncValidationError } from "@temelj/standard-schema";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  compile,
  ConfigurationError,
  documentFrontmatter,
  FrontmatterError,
  LimitError,
  parse,
  ParseError,
  parseFrontmatter,
  parseFrontmatterSync,
  SourceBuffer,
  SourceFile,
  type FrontmatterObject,
  type FrontmatterParseResult,
} from "./mod.ts";
import { SourceText } from "./source-text.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("standalone frontmatter", () => {
  it.each([
    "---\ntitle: Hello\ntags: [one, two]\n---",
    "+++\ntitle = 'Hello'\ntags = ['one', 'two']\n+++",
    "---\n---",
    "+++\n+++",
    "---\n# comment\n---",
    "---\n__proto__: safe\nconstructor: metadata\n---",
    "---\nvalue: 9007199254740993\n---",
    "---\nbase: &base { value: 1 }\ncopy: *base\n---",
    "+++\nvalue = 9007199254740993\ndate = 2026-10-19\nnumber = inf\n+++",
    "---\nvalue: !custom test\n---",
    "---\ntitle: Hello\n---\n---\nother: metadata\n---",
  ])("matches full parsing for %j", async (input) => {
    const file = new SourceFile({ name: "post.mdx", text: input });
    const parsed = parse(file, { syntax: { frontmatter: "auto" } });
    const node = documentFrontmatter(parsed.document);
    const result = parseFrontmatterSync(file);

    expect(result).toEqual({
      file,
      frontmatter: node?.data,
      format: node?.format,
      diagnostics: parsed.diagnostics,
    });
    expect(await parseFrontmatter(file)).toEqual(result);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.frontmatter)).toBe(true);
    expect(Object.isFrozen(result.diagnostics)).toBe(true);
    expect(result).not.toHaveProperty("document");
  });

  it.each(["\n", "\r", "\r\n"])("preserves recognition and offsets with %j newlines", (newline) => {
    for (const prefix of ["", "\uFEFF", " ", "    ", "\t"]) {
      for (const ending of ["", newline]) {
        const text = `${prefix}--- \t${newline}title: Hello${newline}---\t ${ending}`;
        const file = new SourceFile(text);
        const parsed = parse(file, { syntax: { frontmatter: "auto" } });

        expect(parseFrontmatterSync(file).frontmatter).toEqual(
          documentFrontmatter(parsed.document)?.data,
        );
      }
    }
  });

  it.each([
    "",
    "# Post",
    "\n---\ntitle: Hello\n---",
    "---",
    "---\ntitle: Hello",
    "---\ntitle: Hello\n+++",
    "---\ntitle: Hello\n...",
    "> ---\n> title: Hello\n> ---",
  ])("returns empty metadata for an absent or unclosed block in %j", (input) => {
    expect(parseFrontmatterSync(input)).toMatchObject({
      frontmatter: {},
      format: undefined,
      diagnostics: [],
    });
  });

  it("restricts formats without decoding excluded headers", () => {
    expect(parseFrontmatterSync("---\nbad: [\n---", { format: "toml" }).format).toBeUndefined();
    expect(parseFrontmatterSync("+++\nbad = [\n+++", { format: "yaml" }).format).toBeUndefined();
    expect(parseFrontmatterSync("+++\na = 1\n+++", { format: "toml" }).frontmatter).toEqual({
      a: 1,
    });
    expect(parseFrontmatterSync("---\na: 1\n---", { format: "yaml" }).frontmatter).toEqual({
      a: 1,
    });
  });

  it.each([
    "---\nvalue\n---",
    "---\n- value\n---",
    "---\na: 1\na: 2\n---",
    "---\nvalue: &value [*value]\n---",
    "---\n? [a, b]\n: value\n---",
    "---\nwarning: !custom value\nbad: [\n---",
    "---\r\nemoji: 😀\r\nbad: [\r\n---",
    "+++\r\nemoji = '😀'\r\nbad = [\r\n+++",
    `---\nitem: &item [1]\nitems: [${Array.from({ length: 101 }, () => "*item").join(", ")}]\n---`,
  ])("preserves full-parser diagnostics for %j", async (input) => {
    const file = new SourceFile({ name: "invalid.mdx", text: input });
    let expected: ParseError | undefined;

    try {
      parse(file, { syntax: { frontmatter: "auto" } });
    } catch (error) {
      if (!(error instanceof ParseError)) {
        throw error;
      }

      expected = error;
    }

    expect(expected).toBeInstanceOf(ParseError);
    expect(() => parseFrontmatterSync(file)).toThrow(
      expect.objectContaining({ file, diagnostics: expected?.diagnostics }),
    );
    await expect(parseFrontmatter(file)).rejects.toThrow(
      expect.objectContaining({ file, diagnostics: expected?.diagnostics }),
    );
  });

  it("ignores invalid MDX after the header", () => {
    const input = "---\ntitle: Hello\n---\n<Broken {";

    expect(() => parse(input, { syntax: { frontmatter: "auto" } })).toThrow(ParseError);
    expect(parseFrontmatterSync(input).frontmatter).toEqual({ title: "Hello" });
  });

  it("never reads or prepares the body", () => {
    const header = "---\ntitle: Hello\n---\n";
    const input = header + "Body\n".repeat(10_000) + "\0";
    // These originals are called below with their explicit receivers.
    // oxlint-disable-next-line typescript/unbound-method
    const readCharacter = SourceText.prototype.char;
    // oxlint-disable-next-line typescript/unbound-method
    const readSlice = SourceText.prototype.slice;
    // oxlint-disable-next-line typescript/unbound-method
    const includes = String.prototype.includes;

    vi.spyOn(String.prototype, "includes").mockImplementation(function (
      this: string,
      search,
      position,
    ) {
      if (this === input && search === "\0") {
        throw new Error("Scanned the body for NUL");
      }

      return includes.call(this, search, position);
    });
    vi.spyOn(SourceText.prototype, "char").mockImplementation(function (this: SourceText, offset) {
      expect(offset).toBeLessThan(header.length);

      return readCharacter.call(this, offset);
    });
    vi.spyOn(SourceText.prototype, "slice").mockImplementation(function (
      this: SourceText,
      start,
      end,
    ) {
      expect(end).toBeDefined();
      expect(end).toBeLessThanOrEqual(header.length);

      return readSlice.call(this, start, end);
    });

    for (const method of ["grammar", "flatten", "toString"] as const) {
      vi.spyOn(SourceText.prototype, method).mockImplementation(() => {
        throw new Error("Prepared the complete source");
      });
    }

    vi.spyOn(SourceText.prototype, "plain", "get").mockImplementation(() => {
      throw new Error("Scanned the source for NUL");
    });
    vi.spyOn(SourceFile.prototype, "lineCount", "get").mockImplementation(() => {
      throw new Error("Indexed the complete source");
    });

    expect(parseFrontmatterSync(input).frontmatter).toEqual({ title: "Hello" });
  });

  it("reads chunked source without flattening it", () => {
    const buffer = new SourceBuffer({ text: "---\r" });
    buffer.append("\ntitle: Hello\r");
    const file = buffer.append("\n---\r\n<Broken");

    vi.spyOn(SourceText.prototype, "toString").mockImplementation(() => {
      throw new Error("Flattened the source");
    });

    expect(parseFrontmatterSync(file).frontmatter).toEqual({ title: "Hello" });
  });

  it("enforces the full input length and validates limits", () => {
    const source = "---\na: 1\n---\nbody";

    expect(
      parseFrontmatterSync(source, { limits: { maximumSourceLength: source.length } }).frontmatter,
    ).toEqual({ a: 1 });
    expect(() =>
      parseFrontmatterSync(source, { limits: { maximumSourceLength: source.length - 1 } }),
    ).toThrow(LimitError);
    expect(() => parseFrontmatterSync(source, { limits: { maximumSourceLength: -1 } })).toThrow(
      ConfigurationError,
    );
    expect(parseFrontmatterSync("", { limits: { maximumSourceLength: 0 } }).frontmatter).toEqual(
      {},
    );
    expect(() => parseFrontmatterSync("x".repeat(16 * 1024 * 1024 + 1))).toThrow(LimitError);
  });
});

describe("standalone frontmatter schemas", () => {
  const postSchema = ss.object({ title: ss.string(), draft: ss.defaulted(ss.boolean(), false) });

  it("infers synchronous and asynchronous output types", async () => {
    const source = "---\ntitle: Hello\n---";
    const sync = parseFrontmatterSync(source, { frontmatterSchema: postSchema });
    const async = await parseFrontmatter(source, { frontmatterSchema: postSchema });

    expectTypeOf(sync).toEqualTypeOf<
      FrontmatterParseResult<{ readonly title: string; readonly draft: boolean }>
    >();
    expectTypeOf(async).toEqualTypeOf(sync);
    expectTypeOf(parseFrontmatterSync(source).frontmatter).toEqualTypeOf<FrontmatterObject>();
    expectTypeOf(parseFrontmatter(source)).toEqualTypeOf<Promise<FrontmatterParseResult>>();
    expect(sync.frontmatter).toEqual({ title: "Hello", draft: false });
    expect(async.frontmatter).toEqual(sync.frontmatter);

    // @ts-expect-error Output types must come from a schema, not an unchecked type argument.
    parseFrontmatterSync<{ title: string }>(source);
  });

  it("validates absent and empty frontmatter and applies defaults", async () => {
    const schema = ss.object({ title: ss.defaulted(ss.string(), "Untitled") });

    for (const source of ["# Post", "---\n---", "---\ntitle: Unclosed"]) {
      expect(parseFrontmatterSync(source, { frontmatterSchema: schema }).frontmatter).toEqual({
        title: "Untitled",
      });
      expect((await parseFrontmatter(source, { frontmatterSchema: schema })).frontmatter).toEqual({
        title: "Untitled",
      });
      expect(() => parseFrontmatterSync(source, { frontmatterSchema: postSchema })).toThrow(
        FrontmatterError,
      );
    }
  });

  it("supports async validation and rejects it in the sync API", async () => {
    const schema: Schema<unknown, { readonly title: string; readonly draft: boolean }> = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: async (value) => postSchema["~standard"].validate(value),
      },
    };

    expect(
      (await parseFrontmatter("---\ntitle: Hello\n---", { frontmatterSchema: schema })).frontmatter,
    ).toEqual({ title: "Hello", draft: false });
    expect(() =>
      parseFrontmatterSync("---\ntitle: Hello\n---", { frontmatterSchema: schema }),
    ).toThrow(StandardSchemaAsyncValidationError);
    await expect(parseFrontmatter("# Post", { frontmatterSchema: schema })).rejects.toThrow(
      FrontmatterError,
    );
  });

  it("allows schema transformations without compilation transport restrictions", async () => {
    const date = new Date("2026-10-19T00:00:00.000Z");
    const schema = ss.transform(ss.object({ date: ss.string() }), (value) => new Date(value.date));
    const input = "---\ndate: 2026-10-19T00:00:00.000Z\n---";
    const result = parseFrontmatterSync(input, { frontmatterSchema: schema });

    expectTypeOf(result.frontmatter).toEqualTypeOf<Date>();
    expect(result.frontmatter).toEqual(date);
    expect((await parseFrontmatter(input, { frontmatterSchema: schema })).frontmatter).toEqual(
      date,
    );
    await expect(
      compile(parse(input, { syntax: { frontmatter: "auto" } }), { frontmatterSchema: schema }),
    ).rejects.toThrow(FrontmatterError);
  });

  it("shares schema issue paths and source spans with compilation", async () => {
    const file = new SourceFile({
      name: "post.mdx",
      text: "\uFEFF---\r\ntitle: 123\r\n---\r\n# Post",
    });

    const parsed = parse(file, { syntax: { frontmatter: "auto" } });

    const schema: Schema = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: () => ({
          issues: [{ message: "Expected string", path: [{ key: "posts" }, 0, "title"] }],
        }),
      },
    };

    const expected = expect.objectContaining({
      file,
      issue: {
        kind: "schema",
        issues: [{ message: "Expected string", path: [{ key: "posts" }, 0, "title"] }],
      },
      diagnostics: [
        expect.objectContaining({
          code: "mdx.frontmatter.schema",
          message: "posts.0.title: Expected string",
          span: { file, ...documentFrontmatter(parsed.document)?.origin },
        }),
      ],
    });

    expect(() => parseFrontmatterSync(file, { frontmatterSchema: schema })).toThrow(expected);
    await expect(parseFrontmatter(file, { frontmatterSchema: schema })).rejects.toThrow(expected);
    await expect(compile(parsed, { frontmatterSchema: schema })).rejects.toThrow(expected);
  });
});
