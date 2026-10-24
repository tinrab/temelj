import { mdxPlugin } from "./unplugin.ts";

export { BuildError, MdxConfig, type MdxConfigOptions, type MdxPluginOptions } from "./unplugin.ts";

/** Creates the Rspack MDX module compiler. */
export const mdx: typeof mdxPlugin.rspack = mdxPlugin.rspack;
