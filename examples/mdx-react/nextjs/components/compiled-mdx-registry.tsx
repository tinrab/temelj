import type { MdxCodeBlockComponentProps, MdxComponentProps } from "@temelj/mdx-react";
import type React from "react";

import { HtmlContent, defineMdxRegistry } from "@temelj/mdx-react";
import { parseCodeBlockMetadata } from "@temelj/mdx/plugins";

import { KaTeXMath } from "@/components/katex-math";
import { MdxCodeBlock } from "@/components/mdx-code-block";
import { shikiHighlighter } from "@/lib/shiki";

function Alert({ description, title }: { description?: string; title?: string }): React.ReactNode {
  return (
    <aside className="mb-4 rounded-md border p-4">
      {title === undefined ? null : <strong>{title}</strong>}
      {description === undefined ? null : <p>{description}</p>}
    </aside>
  );
}

async function CodeBlock({
  code,
  language,
  meta,
}: MdxCodeBlockComponentProps): Promise<React.ReactNode> {
  const highlighted =
    language === undefined
      ? undefined
      : await shikiHighlighter.highlight({
          code,
          language,
          metadata: parseCodeBlockMetadata(meta),
        });

  if (highlighted !== undefined) {
    return <HtmlContent tree={highlighted} registry={compiledMdxRegistry} />;
  }

  return (
    <pre data-language={language} data-meta={meta}>
      <code>{code}</code>
    </pre>
  );
}

export const compiledMdxRegistry = defineMdxRegistry({
  html: {
    h1: ({
      node: _node,
      ...props
    }: React.HTMLAttributes<HTMLHeadingElement> & MdxComponentProps) => <h1 {...props} />,
    pre: ({ node: _node, ...props }: React.HTMLAttributes<HTMLPreElement> & MdxComponentProps) => (
      <MdxCodeBlock className="mb-4" {...props} />
    ),
  },
  jsx: {
    Alert: { component: Alert },
  },
  markdown: { codeBlock: CodeBlock },
  math: KaTeXMath,
});
