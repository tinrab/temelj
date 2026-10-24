import { build } from "esbuild";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import { mdx } from "./esbuild-plugin.ts";

it("bundles relative MDX imports through esbuild", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "temelj-mdx-esbuild-"));

  try {
    await fs.writeFile(path.join(root, "entry.js"), 'export { default } from "./page.mdx";');
    await fs.writeFile(
      path.join(root, "page.mdx"),
      'import { label } from "./label.js"\n\n# {label}',
    );
    await fs.writeFile(path.join(root, "label.js"), 'export const label = "Bundled MDX heading";');

    const result = await build({
      entryPoints: [path.join(root, "entry.js")],
      bundle: true,
      format: "esm",
      write: false,
      logLevel: "silent",
      external: ["react/jsx-runtime"],
      plugins: [mdx()],
    });

    const code = result.outputFiles.map((file) => file.text).join("\n");

    expect(code).toContain("Bundled MDX heading");
    expect(code).toContain('from "react/jsx-runtime"');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
