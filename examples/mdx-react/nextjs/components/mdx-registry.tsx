import type {
  MdxCodeBlockComponentProps,
  MdxComponentProps,
  PendingMdxMarkdownProps,
} from "@temelj/mdx-react";
import type React from "react";

import { HighlightedCode, defineMdxRegistry } from "@temelj/mdx-react";
import { isString } from "@temelj/value";

import { InlineCode } from "@/components/inline-code";
import { KaTeXMath } from "@/components/katex-math";
import { MdxCodeBlock } from "@/components/mdx-code-block";
import { Alert as UiAlert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { shikiHighlighter } from "@/lib/shiki";
import { cn } from "@/lib/utils";

function MdxAlert({ description, title }: { description?: string; title?: string }) {
  return (
    <UiAlert variant="destructive" className="mb-4">
      {title === undefined ? null : <AlertTitle>{title}</AlertTitle>}
      {description === undefined ? null : <AlertDescription>{description}</AlertDescription>}
    </UiAlert>
  );
}

function Note({ children, title }: React.PropsWithChildren<{ title: string }>) {
  return (
    <aside className="mb-4 rounded-md border p-4">
      <strong>{title}</strong>
      <div>{children}</div>
    </aside>
  );
}

/** Open Markdown renders as it is; references wait for their definitions. */
function PendingMarkdown({ children, node }: PendingMdxMarkdownProps) {
  if (node.kind !== "unresolvedReference") {
    return children;
  }

  switch (node.reference) {
    case "link":
      return <span className="underline decoration-dotted">{children}</span>;
    case "image":
      return <span>{children}</span>;
    case "footnote":
      return null;
  }
}

function CodeBlock({ code, language, meta }: MdxCodeBlockComponentProps): React.ReactNode {
  return (
    <HighlightedCode
      code={code}
      registry={mdxRegistry}
      highlighter={shikiHighlighter}
      language={language}
      meta={meta}
    />
  );
}

function Pre({
  className,
  node: _node,
  ...props
}: React.HTMLAttributes<HTMLPreElement> & MdxComponentProps): React.ReactNode {
  return <MdxCodeBlock className={cn("mb-4", className)} {...props} />;
}

export const mdxRegistry = defineMdxRegistry({
  html: {
    h1: ({ node: _node, ...props }: React.HTMLAttributes<HTMLElement> & MdxComponentProps) => (
      <h2 className="mb-4 text-4xl font-bold" {...props} />
    ),
    h2: ({ node: _node, ...props }: React.HTMLAttributes<HTMLElement> & MdxComponentProps) => (
      <h3 className="mb-4 text-2xl font-bold" {...props} />
    ),
    p: ({ node: _node, ...props }: React.HTMLAttributes<HTMLElement> & MdxComponentProps) => (
      <p className="mb-4" {...props} />
    ),

    pre: Pre,
    code: ({ node: _node, ...props }: React.HTMLAttributes<HTMLElement> & MdxComponentProps) => (
      <InlineCode {...props} />
    ),
  },
  markdown: { codeBlock: CodeBlock },
  math: KaTeXMath,
  jsx: {
    Alert: { component: MdxAlert },
    Note: {
      component: Note,
      pending: ({ children, title }) => (
        <aside aria-busy="true" className="mb-4 animate-pulse rounded-md border p-4">
          <strong>{title ?? "Loading note..."}</strong>
          <div>{children}</div>
        </aside>
      ),
    },
    QuietNote: { component: Note, pending: null },
  },
  pending: {
    jsx: ({ children, name, props }) => (
      <aside aria-busy="true" className="mb-4 animate-pulse rounded-md border p-4">
        <strong>{isString(props.title) ? props.title : `Loading ${name}...`}</strong>
        {children}
      </aside>
    ),
    markdown: PendingMarkdown,
  },
});
