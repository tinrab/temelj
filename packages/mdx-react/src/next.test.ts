// @vitest-environment node
import { expect, it } from "vitest";

import { withMdx } from "./next.ts";

it("merges Next.js page extensions and existing Turbopack configuration", () => {
  const input = {
    pageExtensions: ["tsx", "page.ts"],
    turbopack: {
      resolveAlias: { original: "./original.ts" },
      rules: { "*.svg": { loaders: ["svg-loader"], as: "*.js" } },
    },
  };

  const output = withMdx({
    root: "/application",
    components: "./mdx-components.tsx",
    syntax: { frontmatter: "yaml" },
  })(input);

  expect(output.pageExtensions).toEqual(["tsx", "page.ts", "mdx"]);
  expect(output.turbopack?.resolveAlias).toEqual(input.turbopack.resolveAlias);
  expect(output.turbopack?.rules?.["*.svg"]).toEqual(input.turbopack.rules["*.svg"]);
  expect(output.turbopack?.rules?.["*.mdx"]).toMatchObject({ as: "*.js" });
  expect(input.pageExtensions).toEqual(["tsx", "page.ts"]);
  expect(JSON.parse(JSON.stringify(output.turbopack?.rules?.["*.mdx"]))).toMatchObject({
    loaders: [
      {
        options: {
          providerImportSource: "/application/mdx-components.tsx",
          syntax: { frontmatter: "yaml" },
        },
      },
    ],
  });
});

it("uses Next.js defaults when no page extensions are configured", () => {
  expect(withMdx()().pageExtensions).toEqual(["tsx", "ts", "jsx", "js", "mdx"]);
});

it("rejects a competing MDX Turbopack rule", () => {
  expect(() =>
    withMdx()({ turbopack: { rules: { "*.mdx": { loaders: ["another-mdx-loader"] } } } }),
  ).toThrow("existing *.mdx");
});
