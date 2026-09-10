import type { MdxCodeBlockComponentProps, MdxComponentProps } from "@temelj/mdx-react";
import type React from "react";

import { defineMdxRegistry } from "@temelj/mdx-react";

function Alert({ description, title }: { description?: string; title?: string }): React.ReactNode {
  return (
    <aside className="mb-4 rounded-md border p-4">
      {title === undefined ? null : <strong>{title}</strong>}
      {description === undefined ? null : <p>{description}</p>}
    </aside>
  );
}

function CodeBlock({ code, language, meta }: MdxCodeBlockComponentProps): React.ReactNode {
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
  },
  jsx: {
    Alert: { component: Alert },
  },
  markdown: { codeBlock: CodeBlock },
});
