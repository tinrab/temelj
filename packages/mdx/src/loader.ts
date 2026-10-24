import path from "node:path";

import type { SourceMap } from "./source-map.ts";
import type { SyntaxOptions } from "./syntax-options.ts";

import { MdxConfig } from "./build.ts";

export { BuildError } from "./errors.ts";

/** Turbopack passes loader options as JSON, so only serializable settings are accepted. */
export interface MdxLoaderOptions {
  readonly syntax?: SyntaxOptions;
  /** Absolute paths are rewritten relative to each document. */
  readonly providerImportSource?: string;
  readonly development?: boolean;
}

interface MdxLoaderContext {
  readonly resourcePath: string;
  readonly mode?: string;
  getOptions(): MdxLoaderOptions;
  async(): (error: Error | null, source?: string, map?: SourceMap) => void;
}

/** ESM loader for webpack and Turbopack. */
export function mdxLoader(this: MdxLoaderContext, source: string): void {
  const callback = this.async();
  const options = this.getOptions();
  const config = new MdxConfig({ processor: { syntax: options.syntax } });

  void config
    .transform({
      source,
      filename: this.resourcePath,
      development: options.development ?? isDevelopmentMode(this.mode),
      providerImportSource: resolveProviderImport(this.resourcePath, options.providerImportSource),
    })
    .then(
      // oxlint-disable-next-line promise/no-callback-in-promise -- The loader API requires a callback at this promise boundary.
      (artifact) => callback(null, artifact.code, artifact.map),
      // oxlint-disable-next-line promise/no-callback-in-promise -- Forward rejected compilation through the loader callback.
      (cause: unknown) => callback(cause instanceof Error ? cause : new Error(String(cause))),
    );
}

// loader-runner requires the normal ESM loader to be the default export.
export { mdxLoader as default };

function isDevelopmentMode(mode: string | undefined): boolean {
  return (mode ?? process.env.NODE_ENV) === "development";
}

/** Turbopack and webpack both accept document-relative provider imports. */
function resolveProviderImport(
  resourcePath: string,
  providerImportSource: string | undefined,
): string | undefined {
  if (providerImportSource === undefined || !path.isAbsolute(providerImportSource)) {
    return providerImportSource;
  }

  const relative = path.relative(path.dirname(resourcePath), providerImportSource);

  return `./${relative.replaceAll("\\", "/")}`;
}
