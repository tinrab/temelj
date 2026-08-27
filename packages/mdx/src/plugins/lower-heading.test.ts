import { describe, expect, it } from "vitest";

import { ConfigurationError, LowerHeadingPlugin, Processor } from "../mod.ts";

describe("LowerHeadingPlugin", () => {
  it("lowers rendered headings by one level by default", () => {
    const processor = new Processor({ htmlPlugins: [new LowerHeadingPlugin()] });
    const result = processed(processor.processSync("# First\n\n## Second\n"));

    expect(result.document.toSource()).toBe("# First\n\n## Second");
    expect(result.html.toHtml()).toBe("<h2>First</h2>\n<h3>Second</h3>");
  });

  it("supports a custom offset and clamps headings at level six", () => {
    const processor = new Processor({ htmlPlugins: [new LowerHeadingPlugin({ offset: 2 })] });
    const result = processed(processor.processSync("# First\n\n#### Fourth\n\n###### Sixth\n"));

    expect(result.html.toHtml()).toBe("<h3>First</h3>\n<h6>Fourth</h6>\n<h6>Sixth</h6>");
  });

  it("lowers headings nested in other rendered elements", () => {
    const processor = new Processor({ htmlPlugins: [new LowerHeadingPlugin()] });
    const result = processed(processor.processSync("> # Nested\n"));

    expect(result.html.toHtml()).toBe("<blockquote>\n<h2>Nested</h2>\n</blockquote>");
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid offset %s",
    (offset) => {
      expect(() => new LowerHeadingPlugin({ offset })).toThrow(ConfigurationError);
    },
  );
});

function processed(outcome: ReturnType<Processor["processSync"]>) {
  if (outcome.kind !== "processed") {
    throw new Error(`Expected processed outcome, received ${outcome.kind}`);
  }
  return outcome.value;
}
