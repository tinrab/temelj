import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build, createServer } from "vite";
import { expect, it } from "vitest";

import { mdx } from "./vite.ts";

it("builds relative MDX imports through Vite and leaves raw imports intact", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "temelj-mdx-vite-"));

  try {
    await fs.writeFile(
      path.join(root, "entry.js"),
      'export { default } from "./page.mdx"; export { default as source } from "./page.mdx?raw";',
    );
    await fs.writeFile(
      path.join(root, "page.mdx"),
      'import { label } from "./label.js"\n\n# {label}',
    );
    await fs.writeFile(path.join(root, "label.js"), 'export const label = "Bundled MDX heading";');

    const output = await build({
      configFile: false,
      root,
      logLevel: "silent",
      plugins: [mdx()],
      build: {
        write: false,
        minify: false,
        lib: { entry: path.join(root, "entry.js"), formats: ["es"] },
        rolldownOptions: { external: ["react/jsx-runtime"] },
      },
    });

    const outputs = Array.isArray(output) ? output : [output];

    const code = outputs
      .flatMap((result) => ("output" in result ? result.output : []))
      .filter((item) => item.type === "chunk")
      .map((item) => item.code)
      .join("\n");

    expect(code).toContain("Bundled MDX heading");
    expect(code).toContain("# {label}");
    expect(code).toContain("as default");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("surfaces source errors through Vite development transforms", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "temelj-mdx-vite-error-"));

  const server = await createServer({
    configFile: false,
    root,
    logLevel: "silent",
    plugins: [mdx()],
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
  });

  try {
    await fs.writeFile(path.join(root, "broken.mdx"), "<Broken>");
    await expect(server.transformRequest("/broken.mdx")).rejects.toThrow("broken.mdx:");
  } finally {
    await server.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
