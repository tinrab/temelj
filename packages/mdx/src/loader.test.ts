import { afterEach, expect, it, vi } from "vitest";

import type { MdxLoaderOptions } from "./loader.ts";
import type { SourceMap } from "./source-map.ts";

import loader, { mdxLoader } from "./loader.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

function runLoader(
  source: string,
  options: MdxLoaderOptions = {},
): Promise<{ readonly code: string; readonly map: SourceMap }> {
  return new Promise((resolve, reject) => {
    mdxLoader.call(
      {
        resourcePath: "/app/about/page.mdx",
        mode: "production",
        getOptions: () => options,
        async: () => (error, code, map) => {
          if (error !== null) {
            reject(error);
          } else if (code === undefined || map === undefined) {
            reject(new Error("Missing compiler output"));
          } else {
            resolve({ code, map });
          }
        },
      },
      source,
    );
  });
}

it("exports the callable loader required by loader-runner", () => {
  expect(loader).toBe(mdxLoader);
});

it("uses a relative provider import accepted by both Next.js bundlers", async () => {
  const result = await runLoader("# Page", { providerImportSource: "/app/mdx-components.tsx" });

  expect(result.code).toContain('from "./../mdx-components.tsx"');
  expect(result.map.sources).toEqual(["/app/about/page.mdx"]);
});

it("applies serializable syntax options", async () => {
  const source = "---\ntitle: Hello\n---\n\n# Page";

  expect((await runLoader(source)).code).toContain("title: Hello");
  expect((await runLoader(source, { syntax: { frontmatter: "yaml" } })).code).not.toContain(
    "title: Hello",
  );
});

it("passes source diagnostics to the loader callback", async () => {
  await expect(runLoader("<Broken>")).rejects.toThrow("/app/about/page.mdx:");
});

it("lets bundler production mode override a development NODE_ENV", async () => {
  vi.stubEnv("NODE_ENV", "development");
  const result = await runLoader("# Page");

  expect(result.code).toContain('"react/jsx-runtime"');
  expect(result.code).not.toContain('"react/jsx-dev-runtime"');
});
