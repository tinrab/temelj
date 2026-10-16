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
React bindings for `@temelj/mdx`. Every renderer resolves components through one
registry, renders inert content by default, and never runs plugins or evaluates
code during render.

## Define a registry

```tsx
import {
  defineMdxRegistry,
  HighlightedCode,
  type MdxCodeBlockComponentProps,
} from "@temelj/mdx-react";

function CodeBlock({ code, language, meta }: MdxCodeBlockComponentProps) {
  return <HighlightedCode code={code} highlighter={highlighter} language={language} meta={meta} />;
}

export const registry = defineMdxRegistry({
  html: { h1: Heading },
  markdown: { codeBlock: CodeBlock },
  math: KaTeXMath,
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
```

- `html` overrides lowered elements by tag name. Components receive the
  element's props and a plain `node` with its tag name, attributes, and origin.
- `jsx` lists the components authored JSX may render. Only literal string and
  boolean attributes are passed. An expression, a spread, or an authored
  `children`, `key`, `node`, or `ref` attribute keeps the element inert.
- `markdown.codeBlock` renders fenced code both while it streams and after it
  settles, so it stays mounted. `status` is `"pending"` or `"complete"`.
- `math` renders inline and display math. Without it, math keeps a readable code
  fallback.
- `pending` renders unfinished JSX and unfinished Markdown while streaming.
  `pending.markdown` receives each open construct (a `pending` node) and each
  reference whose definition has not arrived (an `unresolvedReference` node),
  with the safe default rendering as `children`.

The registry is passed as a prop rather than through context, so the static
renderers also work in React Server Components.

## Render content

`HtmlContent` renders a lowered HTML tree: a `Processor` result, a
`lowerHtml()` result, or a tree sent from a server as JSON. It is hook-free.

```tsx
import { Processor } from "@temelj/mdx";
import { HtmlContent } from "@temelj/mdx-react";

const result = await processor.process(source);

return <HtmlContent registry={registry} tree={result.html} />;
```

`SourceContent` parses and lowers source during render without plugins. Parse
outside React, or memoize, when the same source renders often.

```tsx
<SourceContent registry={registry} source="# Hello" syntax={{ math: "auto" }} fallback="Invalid" />
```

## Stream content

`useMdxStream` owns one document session. `consume()` reads a `Response`, a
`ReadableStream`, or an async iterable of strings or bytes; it decodes chunks,
publishes at most once per frame, and completes the document at EOF.

```tsx
import { StreamContent, useMdxStream } from "@temelj/mdx-react";

function Answer() {
  const { view, consume } = useMdxStream({ syntax: { math: "auto" } });

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/answer", { signal: controller.signal })
      .then((response) => consume(response, { signal: controller.signal }))
      .catch(() => {});

    return () => controller.abort();
  }, [consume]);

  return <StreamContent registry={registry} view={view} />;
}
```

Aborting, or calling `reset()`, stops reading and leaves the preview open; the
promise rejects with the abort reason. The hook also returns `append`, `edit`,
`complete`, and `reset` for applications that receive text deltas themselves.
Their identities are stable. Syntax and limit failures publish a `failed` view
before `complete()` throws or `consume()` rejects. Declarative source components
catch those content errors and render their fallback. Other exceptions propagate.

`view` is plain data with a `generation` and one of three kinds:

- `streaming` holds the current `preview`, its diagnostics, and the `limit` the
  source exceeds, if any. Errors stay local to the blocks that contain them; the
  preview always renders.
- `complete` holds the completed document's `html` and the stream `blocks` it
  came from. Pass `html` and synchronous `htmlPlugins` to the hook to run them
  in the store, outside render, so completed output matches a `Processor`.
- `failed` holds the strict completion's diagnostics and the last preview, which
  stays editable. `StreamContent` renders its `fallback` when one is given.

`StreamContent` keys top-level blocks by `BlockId` and memoizes them, so settled
blocks do not re-render as the tail grows, and they stay mounted on completion.
Inside the open block, nodes that kept their identity reuse their elements, so
only the changed path renders again. `useMdxBlockStatus()` returns `"pending"`
for a block that is not settled and `"complete"` otherwise, so components can
defer expensive work. An open fence renders in groups of four lines, so the DOM
only updates the last group.

For a string that grows, such as a chat message from an AI SDK, use
`StreamSourceContent`. Appends reuse the parser session; other changes become
edits. Updates apply in a layout effect, so text never lags a frame. With
`appendOnly`, a longer source is trusted to extend the previous one, which skips
comparing the shared prefix.

```tsx
<StreamSourceContent
  appendOnly
  registry={registry}
  source={message.content}
  status={done ? "complete" : "streaming"}
/>
```

A chat renders one stream per message. Each message owns its `useMdxStream` or
`StreamSourceContent`, so finished messages stop rendering while new ones stream.

## Stream trees from a server

When the server parses, the client only renders. On the server,
`streamBlockEvents()` from `@temelj/mdx` turns text chunks into block events;
send them as newline-delimited JSON. On the client, `useMdxBlocks()` applies
them and returns the same `view` shape:

```tsx
import { StreamContent, useMdxBlocks } from "@temelj/mdx-react";

function ServerAnswer() {
  const { view, consume } = useMdxBlocks();

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/answer-blocks", { signal: controller.signal })
      .then((response) => consume(response, { signal: controller.signal }))
      .catch(() => {});

    return () => controller.abort();
  }, [consume]);

  return <StreamContent registry={registry} view={view} />;
}
```

`consume()` also accepts an async iterable of events, such as a streaming server
function that yields them. Each update carries only the blocks that changed.

## Highlighted code

`HighlightedCode` accepts a synchronous or asynchronous `SyntaxHighlighter`,
such as the Shiki adapter from `@temelj/mdx/plugins`. While its block is
pending, it highlights only completed lines and appends the open line as text,
so a synchronous highlighter runs once per line rather than once per chunk.
Asynchronous results keep the previous highlight mounted until the next one
settles.

## Trusted compilation

`compileTrustedMdx()` parses, transforms, compiles, and evaluates once, then
returns a `TrustedMdxCompileResult` containing the module and compilation data.
Only call it for code that is allowed to execute.

```tsx
const result = await compileTrustedMdx(source, {
  syntax: { frontmatter: "yaml" },
  resolveImport: (specifier) => trustedModules[specifier],
  scope: { name: "Ada" },
});

return <CompiledContent module={result.module} registry={registry} />;
```

`CompiledContent` passes the registry to compiled content as `props.components`,
mapped by `compiledComponents()`: element overrides, JSX components, and the
`codeBlock` and `mathFormula` renderers.

In a Next.js Server Component, compile and render there. With TanStack Start,
call `compile()` in a server function, return the function-body artifact, and
call `evaluateTrustedMdx()` during SSR and hydration. The artifact is
transportable; an evaluated module is not. `evaluateTrustedMdx()` returns the
module directly and rejects with `EvaluationError` on failure. Its `sourceName`,
`issue`, and original `cause` describe the failure. It uses dynamic
function evaluation, so browser use requires a CSP that permits it.

## KaTeX

KaTeX and its stylesheet remain application dependencies:

```tsx
import type { MathComponentProps } from "@temelj/mdx-react";

import katex from "katex";

function KaTeXMath({ source, style }: MathComponentProps) {
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
```

Only the caller-owned KaTeX result enters `dangerouslySetInnerHTML`. Authored raw
HTML stays inert.

## Measure bundles

Run `pnpm --filter @temelj/mdx-react measure:bundles` for minified and gzip
sizes. Bundle tests cap the core stream, the hook with renderer, and the
snapshot renderer alone, and keep Shiki and Unified out of them.
