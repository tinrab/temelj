import { build, emptyDir, type PackageJson } from "@deno/dnt";
import { z } from "npm:zod";

await emptyDir("./npm");

const denoJson = z.object({
  name: z.string(),
  version: z.string(),
  license: z.string(),
  description: z.string(),
  imports: z.record(z.string()),
  exports: z.record(z.string()),
}).parse(JSON.parse(await Deno.readTextFile("./deno.json")));

const dependencies: PackageJson["dependencies"] = {};
for (const [name, version] of Object.entries(denoJson.imports)) {
  if (version.startsWith("npm:")) {
    dependencies[name] = version.substring(version.indexOf("@") + 1);
  }
}

await build({
  entryPoints: Object.entries(denoJson.exports).map(([name, path]) => ({
    name,
    path,
    kind: "export",
  })),
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
    dependencies,
  },
  postBuild() {
    Deno.copyFileSync("LICENSE", "npm/LICENSE");
    Deno.copyFileSync("README.md", "npm/README.md");
  },
});
