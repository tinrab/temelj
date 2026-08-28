import type { Schema } from "@temelj/standard-schema";

import { expect, expectTypeOf, test } from "vitest";

import { compileDocument, compileMdx, parse } from "./mod.ts";

test("compiled math accepts a semantic renderer and keeps readable fallbacks", () => {
  const document = expectParsed(
    parse("$x$\n\n$$ equation\ny\n$$\n", {
      syntax: { math: "dollar" },
    }),
  ).document;
  const artifact = compileDocument(document, { outputFormat: "program" });

  expect(artifact.code).toContain("props.math ?");
  expect(artifact.code).toContain('source:"x", style:"inline"');
  expect(artifact.code).toContain('source:"y", style:"display", meta:"equation"');
  expect(artifact.code).toContain("language-math math-inline");
  expect(artifact.code).toContain("language-math math-display");
  expect(artifact.code).toContain('"data-math-meta":"equation"');
});

test("compileMdx emits a transportable function body from source", async () => {
  const outcome = await compileMdx("# Hello {name}\n", { outputFormat: "functionBody" });
  expect(outcome.kind).toBe("compiled");
  if (outcome.kind !== "compiled") {
    return;
  }

  expect(outcome.artifact.format).toBe("functionBody");
  expect(structuredClone(outcome.artifact)).toEqual(outcome.artifact);
  expect(outcome.artifact.code).not.toMatch(/^\s*(?:export|import)\s/mu);
});

test("compileMdx returns typed validated frontmatter", async () => {
  const schema: Schema<unknown, { readonly title: string }> = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate(value) {
        if (
          typeof value === "object" &&
          value !== null &&
          "title" in value &&
          typeof value.title === "string"
        ) {
          return { value: { title: value.title } };
        }
        return { issues: [{ message: "Expected title" }] };
      },
    },
  };
  const outcome = await compileMdx("---\ntitle: Hello\n---\n\n# Page\n", {
    syntax: { frontmatter: "yaml" },
    frontmatterSchema: schema,
  });
  expectTypeOf(outcome).toMatchTypeOf<Awaited<ReturnType<typeof compileMdx<typeof schema>>>>();
  const compiled = expectCompiled(outcome);
  expect(compiled.frontmatter).toEqual({ title: "Hello" });
  expect(compiled.artifact.frontmatter).toEqual({ title: "Hello" });
});

test("compileMdx rejects non-transportable validated frontmatter", async () => {
  const schema: Schema<unknown, Date> = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate() {
        return { value: new Date("2026-08-28T00:00:00.000Z") };
      },
    },
  };
  const outcome = await compileMdx("---\ntitle: Hello\n---\n", {
    syntax: { frontmatter: "yaml" },
    frontmatterSchema: schema,
  });

  expect(expectInvalid(outcome).diagnostics[0]).toMatchObject({
    code: "mdx.frontmatter.transport",
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

function expectCompiled<TFrontmatter>(
  outcome: import("./compiler.ts").MdxCompileOutcome<TFrontmatter>,
): Extract<import("./compiler.ts").MdxCompileOutcome<TFrontmatter>, { kind: "compiled" }> {
  expect(outcome.kind).toBe("compiled");
  if (outcome.kind !== "compiled") {
    throw new Error(`Expected compiled outcome, received ${outcome.kind}`);
  }
  return outcome;
}

function expectInvalid<TFrontmatter>(
  outcome: import("./compiler.ts").MdxCompileOutcome<TFrontmatter>,
): Extract<import("./compiler.ts").MdxCompileOutcome<TFrontmatter>, { kind: "invalid" }> {
  if (outcome.kind !== "invalid") {
    throw new Error(`Expected invalid outcome, received ${outcome.kind}`);
  }
  return outcome;
}
