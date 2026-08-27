import type { MdxComponentProps, PendingMdxMarkdownProps } from "@temelj/mdx-react";
import type React from "react";

import { HtmlCodeBlockNode } from "@temelj/mdx";
import { HighlightedCode, defineMdxRegistry } from "@temelj/mdx-react";

import { shikiHighlighter } from "../lib/shiki";
import { cn } from "../lib/utils";
import { InlineCode } from "./InlineCode";
import { MdxCodeBlock } from "./MdxCodeBlock";
import { Alert as UiAlert, AlertDescription, AlertTitle } from "./ui/alert";

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

function PendingMarkdown({ children, node }: PendingMdxMarkdownProps) {
  switch (node.kind) {
    case "unresolvedLinkReference":
      return <span className="underline decoration-dotted">{children}</span>;
    case "unresolvedImageReference":
      return <span>{children}</span>;
    case "unresolvedFootnoteReference":
    case "footnoteReference":
    case "footnoteSection":
      return null;
    case "pendingStrong":
    case "pendingEmphasis":
    case "pendingDelete":
    case "pendingCode":
    case "pendingLink":
    case "pendingImage":
      return children;
    case "pendingFencedCode":
      return (
        <HighlightedCode
          code={node.value}
          components={mdxRegistry}
          highlighter={shikiHighlighter}
          language={node.language ?? ""}
        />
      );
  }
}

function CodeBlock({
  className,
  node,
  ...props
}: React.HTMLAttributes<HTMLPreElement> & MdxComponentProps): React.ReactNode {
  if (node instanceof HtmlCodeBlockNode) {
    return (
      <HighlightedCode
        code={node.codeBlock.code}
        components={mdxRegistry}
        highlighter={shikiHighlighter}
        language={node.codeBlock.language}
        meta={node.codeBlock.meta}
      />
    );
  }
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

    pre: CodeBlock,
    code: ({ node: _node, ...props }: React.HTMLAttributes<HTMLElement> & MdxComponentProps) => (
      <InlineCode {...props} />
    ),
  },
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
        <strong>{typeof props.title === "string" ? props.title : `Loading ${name}...`}</strong>
        {children}
      </aside>
    ),
    markdown: PendingMarkdown,
  },
});
