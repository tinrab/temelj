<p align="center">
  <h1 align="center" style="text-decoration:none;">@temelj/mdx-react</h1>
  <br/>
  <p align="center">
    React utilities for MDX.
  </p>
</p>

<p align="center">
  <a href="https://twitter.com/tinrab" rel="nofollow"><img src="https://img.shields.io/badge/created%20by-@tinrab-1d9bf0.svg" alt="Created by Tin Rabzelj"></a>
  <a href="https://jsr.io/@temelj/mdx-react" rel="nofollow"><img src="https://jsr.io/badges/@temelj/mdx-react" alt="jsr"></a>
  <a href="https://opensource.org/licenses/MIT" rel="nofollow"><img src="https://img.shields.io/github/license/tinrab/temelj" alt="License"></a>
</p>

<div align="center">
  <a href="https://jsr.io/@temelj/mdx-react">jsr</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://www.npmjs.com/package/@temelj/mdx-react">npm</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://github.com/tinrab/temelj/issues/new">Issues</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://twitter.com/tinrab">@tinrab</a>
  <br />
</div>

<br/>
<br/>

## Installation

```sh
$ npm install @temelj/mdx-react
```

# Get started

Use `SourceContent` to render an MDX string.

```tsx
import { SourceContent } from "@temelj/mdx-react";

import { registry } from "./registry.tsx";

export function Article({ source }: { source: string }) {
  return (
    <SourceContent
      source={source}
      registry={registry}
      syntax={{ math: "auto" }}
      fallback={(diagnostics) => <pre>{diagnostics.map((item) => item.message).join("\n")}</pre>}
    />
  );
}
```

Parse outside React when you need plugins or reuse the same result:

```tsx
import { Processor } from "@temelj/mdx";
import { HtmlContent } from "@temelj/mdx-react";
import { HeadingIdPlugin } from "@temelj/mdx/plugins";

const processor = new Processor({ htmlPlugins: [new HeadingIdPlugin()] });

export async function Article({ source }: { source: string }) {
  const result = await processor.process(source);
  return <HtmlContent tree={result.html} />;
}
```

`HtmlContent` also accepts a `lowerHtml()` result or a tree received as JSON.
Both static renderers work in RSCs.

Find examples for TanStack Start and NextJS in [examples/mdx-react](../../examples/mdx-react).

## Define a registry

To render JSX components such as `<Note>` or any custom component, you can define a component registry.
Pass it to each renderer that needs these components:

```tsx
import type { MdxComponentProps } from "@temelj/mdx-react";
import type React from "react";

import { defineMdxRegistry } from "@temelj/mdx-react";

function Heading({
  node: _node,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & MdxComponentProps) {
  // Strip node before forwarding props to the DOM.
  return <h1 className="article-heading" {...props} />;
}

function Note({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <aside>
      <strong>{title}</strong>
      {children}
    </aside>
  );
}

export const registry = defineMdxRegistry({
  html: { h1: Heading }, // Override Markdown-generated elements by tag name.
  jsx: {
    Note: {
      component: Note, // Allow <Note title="Tip">...</Note> in authored MDX.
      pending: ({ title }) => <aside aria-busy="true">{title ?? "Loading note..."}</aside>,
    },
  },
  pending: {
    jsx: ({ name }) => <span>Loading {name}...</span>, // Other unfinished JSX.
    markdown: ({ children, node }) =>
      node.kind === "unresolvedReference" ? (
        <span className="unresolved-reference">{children}</span>
      ) : (
        children
      ),
    // Keep the safe default for other pending Markdown.
  },
});
```

## Stream content

This component fetches a plain-text response and parses it in the browser:

```tsx
"use client";

import { StreamContent, useMdxStream } from "@temelj/mdx-react";
import { useEffect, useState } from "react";

export function Answer() {
  const { view, consume, reset } = useMdxStream({ syntax: { math: "auto" } });
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    reset(); // Discard the previous answer if the effect runs again.
    setError(undefined);

    fetch("/api/answer", { signal: controller.signal })
      .then((response) => consume(response, { signal: controller.signal }))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "The stream failed");
        }
      });

    return () => controller.abort(); // Cancel fetch and consumption together.
  }, [consume, reset]);

  return (
    <>
      <StreamContent view={view} />
      {error && <p role="alert">{error}</p>}
    </>
  );
}
```

`consume()` accepts plain-text responses, readable streams, and async iterables of strings or UTF-8 bytes.
It completes at EOF.
The hook also exposes `append`, `edit`, and `complete` for manual input.

| Operation                                | Behavior                                                              |
| ---------------------------------------- | --------------------------------------------------------------------- |
| `reset()`                                | Reject active consumption with `AbortError` and start a new document. |
| Abort the signal                         | Reject with the abort reason and leave the preview open.              |
| Overlapping `consume()` calls            | Reject the second call; reset before starting a replacement.          |
| HTTP, transport, or batch error          | Reject instead of treating the input as completed MDX.                |
| Invalid MDX or completion-plugin failure | Publish a failed view and keep the source editable.                   |

You can also pass already streamed text (e.g. when you have data ready for a chat app):

```tsx
import { StreamSourceContent } from "@temelj/mdx-react";

interface AnswerProps {
  id: string;
  text: string;
  done: boolean;
}

export function Answer({ id, text, done }: AnswerProps) {
  return (
    <StreamSourceContent
      key={id} // One parser session per message.
      source={text} // The whole answer so far, not just the latest chunk.
      status={done ? "complete" : "streaming"}
      fallback="The answer contains unfinished MDX."
    />
  );
}
```

The component appends new text and applies replacements as edits.
`appendOnly` skips the prefix comparison.
Use it only when a longer source always extends the same answer.
To change syntax or limits, remount the component or reset the hook.

| `view.kind` | Content                                                                   |
| ----------- | ------------------------------------------------------------------------- |
| `streaming` | Current preview, diagnostics, and any exceeded limit.                     |
| `complete`  | Final HTML and the identities of the blocks that streamed.                |
| `failed`    | Last preview and diagnostics. A supplied `fallback` replaces the preview. |

## Highlight code

```tsx
"use client";

import type { MdxCodeBlockComponentProps } from "@temelj/mdx-react";

import { defineMdxRegistry, HighlightedCode } from "@temelj/mdx-react";
import { createShikiHighlighter } from "@temelj/mdx/plugins";
import { createHighlighter } from "shiki";

// Preload once, outside React render.
const shiki = await createHighlighter({ langs: ["typescript"], themes: ["github-light"] });
const highlighter = createShikiHighlighter(shiki, {
  theme: "github-light",
  languageAliases: { ts: "typescript" },
});

function CodeBlock({ code, language, meta, status }: MdxCodeBlockComponentProps) {
  return (
    <HighlightedCode
      code={code}
      language={language}
      meta={meta} // Filename, line numbers, and highlighted lines.
      status={status}
      highlighter={highlighter}
    />
  );
}

export const registry = defineMdxRegistry({ markdown: { codeBlock: CodeBlock } });
```

`HighlightedCode` is a client component.
For server-only highlighting, call the highlighter on the server and render its tree with `HtmlContent`.

It's usually desired to declare a separate `CodeBlock` component per-app and style it as you wish.

## Math and KaTeX

Set `syntax.math` to `"dollar"` for inline `$...$` and display `$$...$$`, or `"tex"` for inline `\(...\)` and display `\[...\]`.
`"auto"` accepts both delimiter families in the same document.

```tsx
import type { MathComponentProps } from "@temelj/mdx-react";

import { defineMdxRegistry } from "@temelj/mdx-react";
import katex from "katex";
import "katex/dist/katex.min.css";

function KaTeXMath({ source, style }: MathComponentProps) {
  const html = katex.renderToString(source, {
    displayMode: style === "display",
    throwOnError: false,
    trust: false,
  });

  // Only KaTeX's output enters innerHTML. Authored HTML stays inert.
  return style === "display" ? (
    <div dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <span dangerouslySetInnerHTML={{ __html: html }} />
  );
}

export const registry = defineMdxRegistry({ math: KaTeXMath });
// Pass syntax={{ math: "auto" }} when parsing or using SourceContent.
```

Without a math renderer, formulas keep a readable code fallback.
You can define your own math renderer with `MathRenderPlugin` plugin.

## Trusted compilation

This path executes JavaScript from the MDX source.
Use it only for source you trust to run.

```tsx
import { compileTrustedMdx, CompiledContent } from "@temelj/mdx-react";

// React Server Component.
export async function Article() {
  const result = await compileTrustedMdx("# Hello {name}", {
    scope: { name: "Verso" }, // Bind names used by authored expressions.
  });

  return <CompiledContent module={result.module} />;
}
```

For a loader or server function, return the artifact rather than the evaluated module:

```ts
import type { FunctionBodyCompileArtifact } from "@temelj/mdx";

import { compile, Processor } from "@temelj/mdx";
import { evaluateTrustedMdx } from "@temelj/mdx-react";

// Server: compile without evaluating. The artifact is plain transport data.
async function compileArticle(source: string) {
  const parsed = await new Processor().transform(source);
  return (await compile(parsed)).artifact;
}

// Runtime: evaluate once, then pass the module to CompiledContent.
async function loadArticle(artifact: FunctionBodyCompileArtifact) {
  return evaluateTrustedMdx(artifact);
}
```
