import type { HtmlAttributeValue, HtmlDocumentNode } from "../html.ts";
import type { HtmlTransformContext } from "../plugin.ts";

import { HtmlTransformPlugin } from "../plugin.ts";
import { selectHtml } from "../traversal.ts";

export interface HeadingIdPluginOptions {
  readonly prefix?: string;
}

export class HeadingIdPlugin extends HtmlTransformPlugin {
  public readonly name = "heading-id";
  private readonly prefix: string;

  public constructor(options: HeadingIdPluginOptions = {}) {
    super();
    this.prefix = options.prefix ?? "user-content-";
  }

  public transform(context: HtmlTransformContext): HtmlDocumentNode {
    const used = new Set<string>();
    for (const { node } of selectHtml(context.document, "element")) {
      const id = node.attributes.id;
      if (typeof id === "string") {
        used.add(id);
      }
    }
    return context.rewrite({
      element: ({ node }) => {
        if (!/^h[1-6]$/u.test(node.tagName) || node.attributes.id !== undefined) {
          return node;
        }
        const base = this.prefix + slug(node.toString());
        const id = uniqueSlug(base, used);
        const attributes: Record<string, HtmlAttributeValue> = {
          ...node.attributes,
          id,
        };
        return node.with({ attributes });
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
