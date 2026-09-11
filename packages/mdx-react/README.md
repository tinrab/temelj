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
# npm
$ npm install @temelj/mdx-react
# jsr
$ deno add jsr:@temelj/mdx-react # or jsr add @temelj/mdx-react
```

React bindings for `@temelj/mdx`.

```tsx
import { defineMdxRegistry, SourceContent, StreamingSourceContent } from "@temelj/mdx-react";

const registry = defineMdxRegistry({
  html: { h1: Heading },
  markdown: {
    codeBlock: ({ code, language, meta }) => (
      <HighlightedCode code={code} language={language} meta={meta} />
    ),
  },
  jsx: {
    Alert: { component: Alert },
    Note: {
      component: Note,
      pending: ({ children, title }) => <Loader title={title}>{children}</Loader>,
    },
    QuietNote: { component: Note, pending: null },
  },
  pending: {
    jsx: ({ children, name }) => <Loader title={`Loading ${name}`}>{children}</Loader>,
    markdown: PendingMarkdown,
  },
});

<SourceContent registry={registry} source="# Hello" />;
<StreamingSourceContent registry={registry} source={source} status="streaming" />;
```

Both components use safe HTML lowering and never compile or evaluate source.
Pass syntax options directly when optional syntax is needed. Source components do
not accept processors, so user plugins never execute during React render.
`StreamingSourceContent` owns one `MdxStream`. Source edits happen outside React
render. When status becomes `"complete"`, it completes that stream once and
passes the strict document to the processor without parsing the source again.
Changing `syntax` starts a new stream. Unaffected blocks keep their IDs and React
instances.
An incomplete registered JSX element renders its entry-specific `pending`
component first, then `pending.jsx`. Set `pending: null` on an entry to render
nothing. The renderer waits for an exact committed name, so `<Ale` does not
invoke the `Alert` fallback.

`pending.markdown` receives every safe provisional Markdown node through the
exhaustive `StreamingPendingMarkdownNode` union. This includes unfinished
emphasis, strong text, deletion, code, fences, links, and images; unresolved
references; and resolved footnote references and their provisional document-wide
section. `children` is the node's complete safe default rendering, so returning it
is a pass-through. Return `null` for `footnoteReference`, `footnoteSection`, and
`unresolvedFootnoteReference` to withhold footnotes until strict completion.
Unresolved nodes expose their normalized identifier but never a destination,
image source, or footnote body. Without a callback, unresolved references render
exactly as authored.

`markdown.codeBlock` is the semantic renderer for both open and closed fenced
code. Its `status` is `"pending"` while the closing fence is missing and
`"complete"` once the fence has settled. Using one component for both states
keeps the highlighted code block mounted as streamed lines arrive and when the
closing fence is received. When it is omitted, complete code blocks continue
through `html.pre`, and open fences continue through `pending.markdown`.

Pending props contain only completed quoted strings and committed boolean
attributes. Every prop is optional because a stream can stop before its value.
Expressions, spreads, and authored `children`, `key`, `node`, or `ref`
attributes keep the JSX inert and never invoke registered code. Child
expressions and raw HTML also remain inert, while Markdown children render as
they arrive.

Pending math, expressions, ESM, unsafe JSX, JSX expressions, and spreads never
invoke `pending.markdown`. Committed math uses the caller's `math` component.
Streaming footnotes share document-wide numbering and one live footnote section
unless the pending Markdown component replaces or withholds them.

A syntactically complete component renders immediately, even when later
document content is still streaming. Switching from a pending renderer to the
real component remounts that JSX subtree because its React element type changes.
Surrounding stream blocks keep their identity. Strict completion reports
unfinished JSX through `diagnosticFallback`.

Run configured processors outside React, then pass their outcome to
`ProcessedContent`:

```tsx
const outcome = await processor.process(source);
<ProcessedContent outcome={outcome} registry={registry} />;
```

## Trusted compilation and SSR

`compileTrustedMdx()` restores the direct server workflow for executable MDX.
It parses, validates, compiles, and evaluates once, then returns a discriminated
outcome containing the module. The typed result exposes the validated default
component. Named exports remain on the runtime module and need their own validation
before use. Import resolvers return module objects, and scope bindings retain the
type of the supplied object:

```tsx
const outcome = await compileTrustedMdx(source, {
  resolveImport: (specifier) => trustedModules[specifier],
});

if (outcome.kind === "compiled") {
  return <CompiledContent module={outcome.module} registry={registry} />;
}
```

Only call the trusted APIs for code that is allowed to execute. Compilation
alone does not run expressions or ESM. `evaluateTrustedMdx()` uses dynamic
function evaluation, so browser use also requires a CSP that permits it.

In a Next.js App Router application, call `compileTrustedMdx()` inside a Server
Component and render the resulting module there. Do not send the module or the
semantic document to a Client Component.

TanStack Start uses SSR followed by browser hydration. Compile with
`compileMdx()` in a server function, return its function-body artifact, and call
`evaluateTrustedMdx()` during SSR and hydration. The artifact is transportable;
an evaluated module is not.

The package keeps one root export. Static content renderers and trusted
compilation are hook-free. `StreamingSourceContent` and `HighlightedCode` carry
their own `"use client"` directives for React Server Component bundlers.

## KaTeX

Pass one semantic math component to parsed, streaming, direct HTML, or compiled
content. KaTeX and its stylesheet remain application dependencies:

```tsx
import type { MathComponentProps } from "@temelj/mdx-react";
import katex from "katex";
import type React from "react";
import "katex/dist/katex.min.css";

function KaTeXMath({ source, style }: MathComponentProps): React.ReactNode {
  const html = katex.renderToString(source, {
    displayMode: style === "display",
    throwOnError: false,
    trust: false,
  });
  return style === "display" ? (
    <div dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <span dangerouslySetInnerHTML={{ __html: html }} />
  );
}

<SourceContent source={source} syntax={{ math: "auto" }} math={KaTeXMath} />;
<StreamingSourceContent source={source} status="complete" math={KaTeXMath} />;
<CompiledContent module={trustedModule} math={KaTeXMath} />;
```

Only the caller-owned KaTeX result enters `dangerouslySetInnerHTML`. Authored raw
HTML remains inert. Keep `trust: false` unless the application has reviewed the
KaTeX trust implications for its own input.

`HighlightedCode` accepts a caller-owned highlighting service. Processor plugins
belong outside React and their result can be rendered with `ProcessedContent`.
The React renderer converts HAST attribute names and CSS style strings to React
props. To highlight an open fence while it streams, render `HighlightedCode`
from the `pendingFencedCode` branch of `pending.markdown`, using the node's
`value`, `language`, and `meta`. Each source update replaces the previous
highlighting request. Synchronous highlighters render the updated code in the
same React render. Asynchronous highlighters keep the last highlighted block
mounted until the new result arrives. The same `SyntaxHighlighter` can be passed
to `SyntaxHighlightPlugin` for strict processing. Import its type from
`@temelj/mdx/plugin`, which also exports the optional Shiki adapter.
