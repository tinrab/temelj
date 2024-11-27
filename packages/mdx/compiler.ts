import {
  compile as compileMdxJs,
  type CompileOptions as MdxJsCompileOptions,
} from "@mdx-js/mdx";
import remarkFrontmatterPlugin from "remark-frontmatter";
import remarkGfmPlugin from "remark-gfm";
import { VFile } from "vfile";
import { matter } from "vfile-matter";
import type { Pluggable, PluggableList } from "unified";

import type { PluginFactory } from "./types.ts";

export { remarkFrontmatterPlugin, remarkGfmPlugin };

export type MdxSource = string | Uint8Array;

export interface MdxCompileOptions {
  frontmatterOnly?: boolean | undefined;
  mdxOptions?: MdxJsCompileOptions;
}

export interface MdxArtifact<TFrontmatter = Record<string, unknown>> {
  compiled?: VFile | undefined;
  frontmatter: TFrontmatter;
}

export class MdxCompiler {
  private readonly mdxOptions: MdxCompileOptions;
  private readonly remarkPlugins: PluggableList;
  private readonly rehypePlugins: PluggableList;

  public constructor(
    mdxOptions: MdxCompileOptions = {},
  ) {
    this.mdxOptions = mdxOptions;
    this.remarkPlugins = [remarkFrontmatterPlugin, remarkGfmPlugin];
    this.rehypePlugins = [];
  }

  public withRemarkPlugin<TOptions>(
    plugin: (options?: TOptions) => PluginFactory,
    options?: TOptions,
  ): MdxCompiler {
    if (options === undefined) {
      this.remarkPlugins.push(plugin as Pluggable);
    } else {
      this.remarkPlugins.push([plugin, options] as Pluggable);
    }
    return this;
  }

  public withRehypePlugin<TOptions>(
    plugin: (options?: TOptions) => PluginFactory,
    options?: TOptions,
  ): MdxCompiler {
    if (options === undefined) {
      this.rehypePlugins.push(plugin as Pluggable);
    } else {
      this.rehypePlugins.push([plugin, options] as Pluggable);
    }
    return this;
  }

  public async compile<TFrontmatter = Record<string, unknown>>(
    source: MdxSource,
    { frontmatterOnly = false, mdxOptions }: MdxCompileOptions = {},
  ): Promise<MdxArtifact<TFrontmatter>> {
    const vfile = new VFile({
      value: source,
      // Needed so vfile doesn't access fs
      cwd: "/",
      path: "/",
      message: {},
      messages: {},
    });
    matter(vfile, { strip: true });

    let compiled: VFile | undefined;
    if (!frontmatterOnly) {
      compiled = await compileMdxJs(vfile, {
        remarkPlugins: this.remarkPlugins,
        rehypePlugins: this.rehypePlugins,
        outputFormat: "function-body",
        ...(this.mdxOptions ?? {}),
        ...(mdxOptions ?? {}),
      });
    }

    return { compiled, frontmatter: (vfile.data.matter ?? {}) as TFrontmatter };
  }
}
