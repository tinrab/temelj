import { build, emptyDir, type PackageJson } from "@deno/dnt";

import denoJson from "../deno.json" with { type: "json" };

if (import.meta.main) {
  await emptyDir("./npm");

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
}
