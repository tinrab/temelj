import { mdxPlugin } from "./unplugin.ts";

export { BuildError, MdxConfig, type MdxConfigOptions, type MdxPluginOptions } from "./unplugin.ts";

/** Creates the Rolldown MDX module compiler. */
export const mdx: typeof mdxPlugin.rolldown = mdxPlugin.rolldown;
