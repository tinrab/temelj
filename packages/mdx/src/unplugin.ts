import type { UnpluginContextMeta } from "unplugin";

import { createUnplugin } from "unplugin";

import { isMdxModule, MdxConfig } from "./build.ts";

export { MdxConfig, type MdxBuildInput, type MdxConfigOptions } from "./build.ts";

export { BuildError } from "./errors.ts";

export interface MdxPluginOptions {
  readonly config?: MdxConfig;
  /** Overrides bundler mode detection, including for generic Rollup builds. */
  readonly development?: boolean;
  readonly providerImportSource?: string;
  /** Rejects async documents, which React client renderers cannot render. */
  readonly synchronous?: boolean;
}

/** Compiles MDX component imports for supported unplugin bundlers. */
export const mdxPlugin = createUnplugin<MdxPluginOptions | undefined, false>(
  (options = {}, meta) => {
    const config = options.config ?? new MdxConfig();
    let development = options.development ?? isDevelopmentBuild(meta);

    return {
      name: "temelj-mdx",
      enforce: "pre",
      transformInclude: isMdxModule,
      async transform(source, id) {
        const { code, map } = await config.transform({
          source,
          filename: id.split("?")[0],
          development,
          providerImportSource: options.providerImportSource,
          synchronous: options.synchronous,
        });

        // Bundlers expect mutable source map arrays.
        return {
          code,
          map: {
            ...map,
            sources: [...map.sources],
            sourcesContent: [...map.sourcesContent],
            names: [...map.names],
          },
        };
      },
      vite: {
        configResolved(resolved) {
          development =
            options.development ?? (resolved.command === "serve" && !resolved.isProduction);
        },
      },
    };
  },
);

function isDevelopmentBuild(meta: UnpluginContextMeta): boolean {
  switch (meta.framework) {
    case "webpack":
      return meta.webpack.compiler.options.mode === "development";
    case "rspack":
      return meta.rspack.compiler.options.mode === "development";
    default:
      return false;
  }
}
