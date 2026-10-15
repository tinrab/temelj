import type { Schema } from "@temelj/standard-schema";

import { isObject, isString } from "@temelj/value";
import { expect, expectTypeOf, test } from "vitest";

import {
  compile,
  formatHtml,
  lowerHtml,
  parse,
  Processor,
  type CompileOutcome,
  type HtmlRenderOptions,
  type ParseOptions,
} from "./mod.ts";

test("compiled math accepts a semantic renderer and keeps readable fallbacks", async () => {
  const outcome = await compile(
    expectParsed(parse("$x$\n\n$$ equation\ny\n$$\n", { syntax: { math: "dollar" } })),
    { outputFormat: "program" },
  );

  const code = expectCompiled(outcome).artifact.code;
  expect(code).toContain("_components.mathFormula ?");
  expect(code).toContain('source:"x", style:"inline"');
  expect(code).toContain('source:"y", style:"display", meta:"equation"');
  expect(code).toContain("language-math math-inline");
  expect(code).toContain("language-math math-display");
  expect(code).toContain('"data-math-meta":"equation"');
});

test("compile emits a transportable function body from source", async () => {
  const outcome = await compile(await new Processor().transform("# Hello {name}\n"), {
    outputFormat: "functionBody",
  });

  const compiled = expectCompiled(outcome);

  expect(compiled.artifact.format).toBe("functionBody");
  expect(structuredClone(compiled.artifact)).toEqual(compiled.artifact);
  expect(compiled.artifact.code).not.toMatch(/^\s*(?:export|import)\s/mu);
});

test("compile returns typed validated frontmatter", async () => {
  const schema: Schema<unknown, { readonly title: string }> = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate(value) {
        if (isObject(value) && "title" in value && isString(value.title)) {
          return { value: { title: value.title } };
        }

        return { issues: [{ message: "Expected title" }] };
      },
    },
  };

  const processor = new Processor({ syntax: { frontmatter: "yaml" } });

  const outcome = await compile(await processor.transform("---\ntitle: Hello\n---\n\n# Page\n"), {
    frontmatterSchema: schema,
  });

  expectTypeOf(outcome).toEqualTypeOf<CompileOutcome<{ readonly title: string }>>();
  const compiled = expectCompiled(outcome);
  expect(compiled.frontmatter).toEqual({ title: "Hello" });
  expect(compiled.artifact.frontmatter).toEqual({ title: "Hello" });
});

test("compile rejects non-transportable validated frontmatter", async () => {
  const schema: Schema<unknown, Date> = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate() {
        return { value: new Date("2026-08-28T00:00:00.000Z") };
      },
    },
  };

  const processor = new Processor({ syntax: { frontmatter: "yaml" } });

  const outcome = await compile(await processor.transform("---\ntitle: Hello\n---\n"), {
    frontmatterSchema: schema,
  });

  expect(outcome.kind).toBe("invalid");
  expect(outcome.diagnostics[0]).toMatchObject({ code: "mdx.frontmatter.transport" });
});

const parityFixtures: ReadonlyArray<readonly [string, string, ParseOptions]> = [
  ["tight and loose lists", "- one\n- two\n\n1. a\n\n2. b\n", {}],
  ["task lists", "- [x] done\n- [ ] todo\n", {}],
  [
    "inline markup",
    'Some **strong _nested_** `code` ~~gone~~ and [a link](https://x.test "t").\n',
    {},
  ],
  ["references", "[ref][r] ![img][i]\n\n[r]: https://r.test\n[i]: https://i.test/x.png\n", {}],
  ["unsafe urls", "[bad](javascript:alert(1)) ![bad](data:text/html,x)\n", {}],
  ["footnotes", "One[^a] two[^b] again[^a].\n\n[^a]: First.\n[^b]: Second.\n", {}],
  ["tables", "| a | b |\n| :- | -: |\n| 1 | 2 |\n", {}],
  ["code and breaks", "```ts\nconst a = 1;\n```\n\nline\\\nbreak\n\n---\n\n> quote\n", {}],
  ["directives", ":::note[Label]{#id .x}\nBody\n:::\n", { syntax: { directives: true } }],
  ["math", "$a$\n\n$$\nb\n$$\n", { syntax: { math: "dollar" } }],
];

test.each(parityFixtures)(
  "compiled %s render the same HTML as lowering",
  async (_, source, options) => {
    const parsed = expectParsed(parse(source, options));
    const html: HtmlRenderOptions = { clobberPrefix: "doc-", footnoteLabel: "Notes" };
    const expected = formatHtml(lowerHtml(parsed.document, { ...html, source: parsed.file }));
    const compiled = expectCompiled(await compile(parsed, html));

    expect(normalizeWhitespace(await renderCompiled(compiled.artifact.code))).toBe(
      normalizeWhitespace(expected),
    );
  },
);

test("compiled and lowered output share the URL policy", async () => {
  const parsed = expectParsed(parse("[docs](/docs) ![logo](/logo.png)\n"));

  const html: HtmlRenderOptions = {
    urlTransform: (url, kind, sanitized) =>
      kind === "link" ? `https://site.test${url}` : sanitized,
  };

  const compiled = expectCompiled(await compile(parsed, html));
  const rendered = await renderCompiled(compiled.artifact.code);

  expect(rendered).toContain('href="https://site.test/docs"');
  expect(rendered).toContain('src="/logo.png"');
  expect(formatHtml(lowerHtml(parsed.document, html))).toContain('href="https://site.test/docs"');
});

test("a paragraph of only JSX and expressions renders without a p", async () => {
  const parsed = expectParsed(parse("<A /> {1}\n\n<B>text</B>\n"));
  const html = formatHtml(lowerHtml(parsed.document, { source: parsed.file }));

  expect(html).not.toContain("<p>");
});

test("function bodies resolve imports and return authored exports", async () => {
  const source =
    'import {value} from "values"\nexport * from "more"\nexport {wrap as default, extra as renamed} from "layout"\nexport const local = value + 1\n\n# Title\n';

  const outcome = await compile(expectParsed(parse(source)), {
    outputFormat: "functionBody",
    providerImportSource: "provider",
  });

  const compiled = expectCompiled(outcome);

  if (compiled.artifact.format !== "functionBody") {
    throw new Error("Expected a function body");
  }

  expect(compiled.artifact.imports).toEqual(["values", "more", "layout", "provider"]);

  const wrap = ({ children }: RenderedProps): RenderedValue => children;

  const modules = new Map<string, TestModule>([
    ["values", { value: 41 }],
    ["more", { default: "ignored", star: "spread" }],
    ["layout", { wrap, extra: "extra" }],
    ["provider", { useMDXComponents: () => ({}) }],
  ]);

  const element = (type: string | symbol, props: RenderedProps): RenderedElement =>
    new RenderedElement(type, props);

  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const run = new AsyncFunction("__mdxRuntime", "__resolveMdxImport", compiled.artifact.code);

  const module = await run(
    { Fragment: Symbol("Fragment"), jsx: element, jsxs: element },
    async (specifier: string) => modules.get(specifier),
  );

  expect(module).toMatchObject({ local: 42, renamed: "extra", star: "spread" });
  // The re-exported default export is the layout around the content.
  expect(module.default({})).toMatchObject({ type: wrap, props: { children: { type: "h1" } } });
});

/** Evaluates a compiled function body with a string-rendering JSX runtime. */
async function renderCompiled(code: string): Promise<string> {
  const fragment = Symbol("Fragment");

  const element = (type: string | symbol, props: RenderedProps): RenderedElement =>
    new RenderedElement(type, props);

  const runtime = { Fragment: fragment, jsx: element, jsxs: element };
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const run = new AsyncFunction("__mdxRuntime", "__resolveMdxImport", "frontmatter", code);
  const module = await run(runtime, () => {}, {});

  return renderString(module.default({}), fragment);
}

type RenderedValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | RenderedElement
  | readonly RenderedValue[];

type RenderedProps = Readonly<Record<string, RenderedValue>>;

type TestModule = Readonly<
  Record<string, number | string | ((props: RenderedProps) => RenderedValue | object)>
>;

class RenderedElement {
  public readonly type: string | symbol;
  public readonly props: RenderedProps;

  public constructor(type: string | symbol, props: RenderedProps) {
    this.type = type;
    this.props = props;
  }
}

function renderString(value: RenderedValue, fragment: symbol): string {
  if (value === null || value === undefined || value === false || value === true) {
    return "";
  }

  if (Array.isArray(value)) {
    return value.map((item) => renderString(item, fragment)).join("");
  }

  if (!(value instanceof RenderedElement)) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  }

  const children = renderString(value.props.children, fragment);

  if (value.type === fragment) {
    return children;
  }

  const tagName = String(value.type);

  const attributes = Object.entries(value.props).flatMap(([name, item]) => {
    if (name === "children" || item === false || item === undefined) {
      return [];
    }

    const attribute = name === "className" ? "class" : name;

    return item === true
      ? [attribute]
      : [`${attribute}="${String(item).replaceAll("&", "&amp;").replaceAll('"', "&#x22;")}"`];
  });

  const opening = `<${tagName}${attributes.length === 0 ? "" : ` ${attributes.join(" ")}`}>`;
  const isVoid = ["br", "hr", "img", "input"].includes(tagName);

  return isVoid ? opening : `${opening}${children}</${tagName}>`;
}

function normalizeWhitespace(html: string): string {
  return html.replace(/>\s+</gu, "><").trim();
}

function expectParsed(
  outcome: ReturnType<typeof parse>,
): Extract<ReturnType<typeof parse>, { kind: "ok" }> {
  if (outcome.kind !== "ok") {
    throw new Error(`Expected parsed outcome, received ${outcome.kind}`);
  }

  return outcome;
}

function expectCompiled<TFrontmatter>(
  outcome: CompileOutcome<TFrontmatter>,
): Extract<CompileOutcome<TFrontmatter>, { kind: "ok" }> {
  if (outcome.kind !== "ok") {
    throw new Error(`Expected compiled outcome, received ${outcome.kind}`);
  }

  return outcome;
}
