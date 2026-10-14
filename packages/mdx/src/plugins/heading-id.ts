import { isString } from "@temelj/value";

import type { HtmlRootNode } from "../html.ts";
import type { HtmlPlugin, HtmlPluginContext } from "../plugin.ts";

import { htmlText } from "../html.ts";
import { selectHtml } from "../traversal.ts";

export interface HeadingIdPluginOptions {
  readonly prefix?: string;
}

/** Adds unique slug IDs to rendered headings that have none. */
export class HeadingIdPlugin implements HtmlPlugin {
  public readonly name = "heading-id";
  private readonly prefix: string;

  public constructor(options: HeadingIdPluginOptions = {}) {
    this.prefix = options.prefix ?? "user-content-";
  }

  public transform(context: HtmlPluginContext): HtmlRootNode {
    const used = new Set<string>();

    for (const { node } of selectHtml(context.root, "element")) {
      const id = node.attributes.id;

      if (isString(id)) {
        used.add(id);
      }
    }

    return context.rewrite({
      element: ({ node }) => {
        if (!/^h[1-6]$/u.test(node.tagName) || node.attributes.id !== undefined) {
          return;
        }

        const id = uniqueSlug(this.prefix + slug(htmlText(node)), used);

        return { ...node, attributes: { ...node.attributes, id } };
      },
    });
  }
}

function slug(value: string): string {
  const result = value
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, "")
    .replace(/[\s_-]+/gu, "-")
    .replace(/^-|-$/gu, "");

  return result.length === 0 ? "section" : result;
}

function uniqueSlug(base: string, used: Set<string>): string {
  let value = base;
  let index = 0;

  while (used.has(value)) {
    value = `${base}-${++index}`;
  }

  used.add(value);

  return value;
}
