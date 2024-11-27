import {
  compile as compileMdxJs,
  type CompileOptions as MdxJsCompileOptions,
} from "@mdx-js/mdx";
import remarkFrontmatterPlugin from "remark-frontmatter";
import remarkGfmPlugin from "remark-gfm";
import { VFile } from "vfile";
import { matter } from "vfile-matter";
import type { Pluggable, PluggableList } from "unified";
import type { z } from "zod";

import type { PluginFactory } from "./types.ts";

export { remarkFrontmatterPlugin, remarkGfmPlugin };

/**
 * Represents the source content for an MDX document.
 */
export type MdxSource = string | Uint8Array;

/**
 * Options for compiling an MDX document.
 */
export interface MdxCompileOptions<TFrontmatter = Record<string, unknown>> {
  frontmatterOnly?: boolean | undefined;
  frontmatterSchema?: z.ZodSchema<TFrontmatter>;
  mdxOptions?: MdxJsCompileOptions;
}

/**
 * The result of compiling an MDX document.
 * Compiled content is optional, because sometimes we only need the frontmatter.
 */
export interface MdxArtifact<TFrontmatter = Record<string, unknown>> {
  compiled?: string | undefined;
  frontmatter: TFrontmatter;
}

/**
 * A reusable compiler for compiling MDX.
 */
export class MdxCompiler {
  private readonly mdxOptions: MdxJsCompileOptions;
  private readonly remarkPlugins: PluggableList;
  private readonly rehypePlugins: PluggableList;

  public constructor(
    mdxOptions: MdxJsCompileOptions = {},
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

  public async compile<
    TFrontmatter = Record<string, unknown>,
  >(
    source: MdxSource,
    { frontmatterOnly = false, frontmatterSchema, mdxOptions }:
      MdxCompileOptions<TFrontmatter> = {},
  ): Promise<MdxArtifact<TFrontmatter>> {
    const vfile = new VFile({
      value: source,
      // Needed so vfile doesn't need to access fs.
      cwd: "/",
      path: "/",
      message: {},
      messages: {},
    });
    matter(vfile, { strip: true });

    const remarkPlugins = this.mdxOptions.remarkPlugins ?? this.remarkPlugins;
    const rehypePlugins = this.mdxOptions.rehypePlugins ?? this.rehypePlugins;

    if (mdxOptions?.remarkPlugins) {
      remarkPlugins.push(...mdxOptions.remarkPlugins);
    }
    if (mdxOptions?.rehypePlugins) {
      rehypePlugins.push(...mdxOptions.rehypePlugins);
    }

    let compiled: string | undefined;
    if (!frontmatterOnly) {
      const compiledFile = await compileMdxJs(vfile, {
        outputFormat: "function-body",
        ...(this.mdxOptions ?? {}),
        ...(mdxOptions ?? {}),
        remarkPlugins,
        rehypePlugins,
      });
      compiled = compiledFile.value.toString();
    }

    const frontmatter = frontmatterSchema === undefined
      ? (vfile.data.matter ?? {}) as TFrontmatter
      : frontmatterSchema.parse(vfile.data.matter ?? {});

    return {
      compiled,
      frontmatter,
    };
  }
}
