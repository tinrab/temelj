import { build, emptyDir } from "@deno/dnt";
import { z } from "npm:zod";

await emptyDir("./npm");

const denoJson = z.object({
  name: z.string(),
  version: z.string(),
  license: z.string(),
  description: z.string(),
}).parse(JSON.parse(await Deno.readTextFile("./deno.json")));

await build({
  entryPoints: [
    {
      path: "./lib/array/mod.ts",
      name: "./array",
      kind: "export",
    },
    {
      path: "./lib/id/mod.ts",
      name: "./id",
      kind: "export",
    },
    {
      path: "./lib/promise/mod.ts",
      name: "./promise",
      kind: "export",
    },
    {
      path: "./lib/value/mod.ts",
      name: "./value",
      kind: "export",
    },
  ],
  outDir: "./npm",
  shims: {
    deno: true,
  },
  typeCheck: false,
  test: false,
  scriptModule: false,
  declaration: "separate",
  package: {
    name: denoJson.name,
    version: denoJson.version,
    description: denoJson.description,
    license: denoJson.license,
    repository: {
      type: "git",
      url: "git+https://github.com/flinect/temelj.git",
    },
    bugs: {
      url: "https://github.com/flinect/temelj/issues",
    },
  },
  postBuild() {
    Deno.copyFileSync("LICENSE", "npm/LICENSE");
    Deno.copyFileSync("README.md", "npm/README.md");
  },
});
