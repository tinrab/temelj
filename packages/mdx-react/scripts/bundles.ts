import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const packageDirectory = fileURLToPath(new URL("../", import.meta.url));

export interface BundleMeasurement {
  readonly entry: "core" | "react" | "snapshot";
  readonly bytes: number;
  readonly gzipBytes: number;
  readonly inputs: readonly string[];
}

export async function measureBundles(): Promise<readonly BundleMeasurement[]> {
  const entries = [
    ["core", 'import { MdxStream } from "@temelj/mdx"; console.log(MdxStream);'],
    [
      "react",
      'import { useMdxStream, StreamContent } from "./src/mod.ts"; console.log(useMdxStream, StreamContent);',
    ],
    ["snapshot", 'import { StreamContent } from "./src/mod.ts"; console.log(StreamContent);'],
  ] as const;

  return Promise.all(
    entries.map(async ([entry, contents]) => {
      const result = await build({
        stdin: { contents, resolveDir: packageDirectory },
        bundle: true,
        write: false,
        minify: true,
        platform: "browser",
        format: "esm",
        target: "es2022",
        external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom"],
        metafile: true,
        logLevel: "silent",
      });

      const code = result.outputFiles[0].contents;
      const output = Object.values(result.metafile.outputs)[0];

      const inputs = Object.entries(output.inputs).flatMap(([path, input]) =>
        input.bytesInOutput === 0 ? [] : [path],
      );

      return { entry, bytes: code.length, gzipBytes: gzipSync(code, { level: 9 }).length, inputs };
    }),
  );
}
