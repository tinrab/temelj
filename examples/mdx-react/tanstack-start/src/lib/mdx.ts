import type { SyntaxOptions } from "@temelj/mdx";

export const mdxSyntax = {
  directives: true,
  frontmatter: "auto",
  math: "auto",
} satisfies SyntaxOptions;
