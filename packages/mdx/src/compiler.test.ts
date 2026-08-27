import { expect, test } from "vitest";

import { compile, parse } from "./mod.ts";

test("compiled math accepts a semantic renderer and keeps readable fallbacks", () => {
  const document = expectParsed(
    parse("$x$\n\n$$ equation\ny\n$$\n", {
      syntax: { math: "dollar" },
    }),
  ).document;
  const artifact = compile(document);

  expect(artifact.code).toContain("props.math ?");
  expect(artifact.code).toContain('source:"x", style:"inline"');
  expect(artifact.code).toContain('source:"y", style:"display", meta:"equation"');
  expect(artifact.code).toContain("language-math math-inline");
  expect(artifact.code).toContain("language-math math-display");
  expect(artifact.code).toContain('"data-math-meta":"equation"');
});

function expectParsed(
  outcome: ReturnType<typeof parse>,
): Extract<ReturnType<typeof parse>, { kind: "parsed" }> {
  if (outcome.kind !== "parsed") {
    throw new Error(`Expected parsed outcome, received ${outcome.kind}`);
  }
  return outcome;
}
