import {
  compile as compileMdxJs,
  type CompileOptions as MdxJsCompileOptions,
} from "@mdx-js/mdx";
import remarkFrontmatterPlugin from "remark-frontmatter";
import remarkGfmPlugin from "remark-gfm";
import { VFile } from "vfile";
import { matter } from "vfile-matter";
import type { Pluggable, PluggableList } from "unified";
import type * as v from "valibot";
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
export interface MdxCompileOptions {
  frontmatterOnly?: boolean | undefined;
  mdxOptions?: MdxJsCompileOptions;
}

/**
 * The input frontmatter schema.
 */
export type FrontmatterInput =
  | z.AnyZodObject
  | v.ObjectSchema<v.ObjectEntries, undefined>;

/**
 * The output frontmatter type for a schema.
 */
export type FrontmatterOutput<
  T extends
    | z.AnyZodObject
    | v.ObjectSchema<v.ObjectEntries, undefined>,
> = T extends z.ZodSchema ? z.infer<T>
  : T extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>
    ? v.InferOutput<T>
  : never;

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

  public constructor(mdxOptions: MdxJsCompileOptions = {}) {
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

  public async compile<TFrontmatterSchema extends FrontmatterInput>(
    source: MdxSource,
    {
      frontmatterOnly = false,
      mdxOptions,
    }: MdxCompileOptions = {},
    frontmatterSchema?: TFrontmatterSchema,
  ): Promise<
    MdxArtifact<FrontmatterOutput<TFrontmatterSchema>>
  > {
    const vfile = new VFile({
      value: source,
      // Needed so vfile doesn't need to access fs.
      cwd: "/",
      path: "/",
      message: {},
      messages: {},
    });
    matter(vfile, { strip: true });

    const remarkPlugins = [
      ...this.remarkPlugins,
      ...(this.mdxOptions?.remarkPlugins ?? []),
      ...(mdxOptions?.remarkPlugins ?? []),
    ];
    const rehypePlugins = [
      ...this.rehypePlugins,
      ...(this.mdxOptions?.rehypePlugins ?? []),
      ...(mdxOptions?.rehypePlugins ?? []),
    ];

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

    let frontmatter: unknown = {};
    if (frontmatterSchema && vfile.data.matter) {
      if ("parse" in frontmatterSchema) {
        frontmatter = frontmatterSchema.parse(vfile.data.matter);
      } else if (
        "kind" in frontmatterSchema && frontmatterSchema.kind === "schema"
      ) {
        const valibot = await import("valibot");
        frontmatter = valibot.parse(frontmatterSchema, vfile.data.matter);
      }
    }

    return {
      compiled,
      frontmatter: frontmatter as FrontmatterOutput<TFrontmatterSchema>,
    };
  }
}
