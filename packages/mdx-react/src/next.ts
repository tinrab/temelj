import type { MdxLoaderOptions } from "@temelj/mdx/loader";
import type { NextConfig } from "next";

import path from "node:path";
import { fileURLToPath } from "node:url";

export interface NextMdxOptions {
  /** Application directory. Defaults to the directory running Next.js. */
  readonly root?: string;
  /** Module exporting a server-compatible useMDXComponents function. */
  readonly components?: string;
  readonly syntax?: MdxLoaderOptions["syntax"];
}

/** Turbopack passes loader options as JSON, so unset keys are omitted. */
type LoaderRuleOptions = {
  -readonly [Key in "syntax" | "providerImportSource"]?: MdxLoaderOptions[Key];
};

const DEFAULT_PAGE_EXTENSIONS = ["tsx", "ts", "jsx", "js"];

/** Adds native MDX pages and imports to Next.js webpack and Turbopack builds. */
export function withMdx(options: NextMdxOptions = {}): (config?: NextConfig) => NextConfig {
  const root = path.resolve(options.root ?? process.cwd());
  const loader = fileURLToPath(import.meta.resolve("@temelj/mdx/loader"));
  const loaderOptions: LoaderRuleOptions = {};

  if (options.syntax !== undefined) {
    loaderOptions.syntax = options.syntax;
  }

  if (options.components !== undefined) {
    loaderOptions.providerImportSource = path
      .resolve(root, options.components)
      .replaceAll("\\", "/");
  }

  const rule = { loader, options: loaderOptions };

  return (config = {}) => {
    if (config.turbopack?.rules?.["*.mdx"] !== undefined) {
      throw new Error("withMdx: remove the existing *.mdx Turbopack rule");
    }

    return {
      ...config,
      pageExtensions: [...new Set([...(config.pageExtensions ?? DEFAULT_PAGE_EXTENSIONS), "mdx"])],
      turbopack: {
        ...config.turbopack,
        rules: {
          ...config.turbopack?.rules,
          "*.mdx": { loaders: [rule], as: "*.js" },
        },
      },
      webpack(webpackConfig, context) {
        webpackConfig.module.rules.push({ test: /\.mdx$/, use: [rule] });

        return config.webpack == null ? webpackConfig : config.webpack(webpackConfig, context);
      },
    };
  };
}
