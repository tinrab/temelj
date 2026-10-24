import type { Schema } from "@temelj/standard-schema";

import { describe, expect, it } from "vitest";

import { isMdxModule, MdxConfig } from "./build.ts";
import { BuildError } from "./errors.ts";

describe("MDX build configuration", () => {
  it("preserves module imports, metadata, provider, and source maps without evaluating imports", async () => {
    const config = new MdxConfig({ processor: { syntax: { frontmatter: "yaml" } } });
    const source = `---\ntitle: Hello\n---\n\nimport { Widget } from "./missing.tsx"\n\nexport const metadata = { title: "Hello" }\n\n# Page\n\n<Widget />`;

    const artifact = await config.transform({
      source,
      filename: "/content/page.mdx",
      providerImportSource: "/components.tsx",
    });

    expect(artifact.code).toContain('from "./missing.tsx"');
    expect(artifact.code).toContain("export const metadata");
    expect(artifact.code).toContain("export default function");
    expect(artifact.code).toContain('from "/components.tsx"');
    expect(artifact.code).not.toContain("export const frontmatter");
    expect(artifact.frontmatter).toEqual({ title: "Hello" });
    expect(artifact.map.sources).toEqual(["/content/page.mdx"]);
    expect(artifact.map.sourcesContent).toEqual([source]);
    expect(artifact.map.mappings).not.toBe("");
  });

  it("runs document plugins before compilation", async () => {
    const config = new MdxConfig({
      processor: {
        documentPlugins: [
          {
            name: "change-heading",
            transform(context) {
              return context.rewrite({ heading: ({ node }) => ({ ...node, depth: 2 }) });
            },
          },
        ],
      },
    });

    const artifact = await config.transform({ source: "# Page", filename: "page.mdx" });

    expect(artifact.code).toContain('h2:"h2"');
    expect(artifact.code).not.toContain('h1:"h1"');
  });

  it("validates frontmatter through Standard Schema", async () => {
    const schema: Schema = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: () => ({ issues: [{ message: "A title is required" }] }),
      },
    };

    const config = new MdxConfig({ frontmatterSchema: schema });

    await expect(config.transform({ source: "# Page", filename: "schema.mdx" })).rejects.toThrow(
      "A title is required",
    );
  });

  it("selects the JSX runtime for each invocation", async () => {
    const config = new MdxConfig();

    const development = await config.transform({
      source: "# Page",
      filename: "page.mdx",
      development: true,
    });

    const production = await config.transform({ source: "# Page", filename: "page.mdx" });

    expect(development.code).toContain("react/jsx-dev-runtime");
    expect(production.code).toContain("react/jsx-runtime");
    expect(production.code).not.toContain("jsxDEV");
  });

  it("rejects async content only when synchronous rendering is requested", async () => {
    const config = new MdxConfig();
    const input = { source: "# {await Promise.resolve('Hello')}", filename: "async.mdx" };

    await expect(config.transform({ ...input, synchronous: true })).rejects.toThrow(
      "async.mdx: async MDX documents",
    );

    const artifact = await config.transform(input);

    expect(artifact.async).toBe(true);
    expect(artifact.code).toContain("export default async function");
  });

  it("reports the filename and location of invalid MDX", async () => {
    const result = new MdxConfig().transform({
      source: "<Widget>",
      filename: "/content/broken.mdx",
    });

    await expect(result).rejects.toBeInstanceOf(BuildError);
    await expect(result).rejects.toThrow(/^\/content\/broken\.mdx: \d+:\d+-\d+:\d+ error/);
  });

  it.each([
    ["page.mdx", true],
    ["page.mdx?import", true],
    ["page.mdx?raw", false],
    ["page.mdx?url", false],
    ["page.md", false],
    ["page.tsx", false],
  ])("filters module request %s", (id, expected) => {
    expect(isMdxModule(id)).toBe(expected);
  });
});
