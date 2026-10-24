<p align="center">
  <h1 align="center" style="text-decoration:none;">@temelj/mdx</h1>
  <br/>
  <p align="center">
    MDX parsing, formatting, compilation, safe rendering, and streaming.
  </p>
</p>

<p align="center">
  <a href="https://twitter.com/tinrab" rel="nofollow"><img src="https://img.shields.io/badge/created%20by-@tinrab-1d9bf0.svg" alt="Created by Tin Rabzelj"></a>
  <a href="https://jsr.io/@temelj/mdx" rel="nofollow"><img src="https://jsr.io/badges/@temelj/mdx" alt="jsr"></a>
  <a href="https://opensource.org/licenses/MIT" rel="nofollow"><img src="https://img.shields.io/github/license/tinrab/temelj" alt="License"></a>
</p>

<div align="center">
  <a href="https://jsr.io/@temelj/mdx">jsr</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://www.npmjs.com/package/@temelj/mdx">npm</a>
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
$ npm install @temelj/mdx
```

## Get started

Use `parse()` to parse an MDX string into a tree.
Then, render that tree as HTML.

```ts
import { formatHtml, formatMdx, lowerHtml, parse } from "@temelj/mdx";

const { document, file } = parse("# Hello\n\nSome **MDX**.");

console.log(formatHtml(lowerHtml(document, { source: file })));
// <h1>Hello</h1>
// <p>Some <strong>MDX</strong>.</p>

// Or write the tree back as canonical MDX.
console.log(formatMdx(document));
```

Parser runs in the browser or on the server and returns readonly trees you can serialize as JSON.
For React, use [`@temelj/mdx-react`](../mdx-react/README.md).

## The MDX dialect

The default grammar supports CommonMark 0.31.2 with GFM extensions.
It also parses MDX v3 syntax.
You can configure how syntax works.

```ts
import { parse } from "@temelj/mdx";

const source = [
  "---",
  "title: Matrices",
  "---",
  "",
  "The tile area is $M \\times N$.",
  "",
  ":::note",
  "Start with a small tile.",
  ":::",
].join("\n");

const result = parse(source, {
  syntax: {
    frontmatter: "auto", // Also "yaml" or "toml".
    math: "auto", // Also "dollar" or "tex".
    directives: true,
    strikethroughMarkerCount: 2, // Use 1 to also accept ~deleted~.
  },
});
```

Math is disabled by default.
Set `syntax.math` to `"dollar"` for inline `$...$` and display `$$...$$`, or `"tex"` for inline `\(...\)` and display `\[...\]`.
`"auto"` accepts both delimiter families in the same document.

## Parse a document

```ts
import { parse, SourceFile } from "@temelj/mdx";

// Give the source a filename for diagnostics.
const file = new SourceFile({
  name: "article.mdx",
  text: "# Matrices\n\nMultiply **rows**.",
});

const result = parse(file);
console.log(result.document.kind); // "document"
console.log(result.diagnostics); // Warnings; syntax errors throw ParseError.
console.log(result.file.location(2)); // { offset: 2, line: 1, column: 3 }
```

You can choose to parse only the frontmatter with `parseFrontmatter`.

## Parse into AST

```ts
import { formatMdx, nodeText, parse, rewriteMdx, selectMdx } from "@temelj/mdx";

const result = parse("# Matrices\n\n![Tile](/tile.png)\n\n---\n");

// Select nodes by kind.
// Origins point into the original source file.
for (const { node } of selectMdx(result.document, "heading")) {
  console.log(node.depth, nodeText(node)); // 1, "Matrices"
  if (node.origin !== undefined) {
    console.log(result.file.slice(node.origin)); // "# Matrices"
  }
}

// Rewrite without mutating the original document.
const edited = rewriteMdx(result.document, {
  thematicBreak: () => null, // Remove a node.
  image: ({ node }) => ({ ...node, url: node.url.replace(/\.png$/u, ".webp") }),
  // Returning undefined keeps a node as it is.
});

console.log(formatMdx(edited, { bullet: "-", emphasis: "_" }));
```

Use `walkMdx()` when you need a visitor rather than a selection.
HTML trees have matching `walkHtml()`, `selectHtml()`, and `rewriteHtml()` helpers.

`indexDocument()` finds definitions and footnotes.
`documentFrontmatter()` reads decoded frontmatter.

## Render HTML

```ts
import { formatHtml, lowerHtml, parse } from "@temelj/mdx";

const result = parse('{2 + 2}\n\n<Alert title="Note" />');
const html = lowerHtml(result.document, { source: result.file });

console.log(formatHtml(html));
// {2 + 2}
//
// &lt;Alert title="Note" />
```

Raw HTML is escaped too.

For HTML you trust, pass `rawHtml: "trusted"` to the serializer:

```ts
import { formatHtml, lowerHtml, parse } from "@temelj/mdx";

const result = parse("<!-- A comment -->");
const html = lowerHtml(result.document, { source: result.file });

console.log(formatHtml(html)); // &lt;!-- A comment -->
console.log(formatHtml(html, { rawHtml: "trusted" })); // <!-- A comment -->
// This option does not evaluate JSX or expressions.
```

ESM is omitted.
Unsafe link and image URLs are removed during lowering.
Use `urlTransform` to customize that.

Code blocks, math, and footnotes keep semantic node kinds until rendered.
Use `htmlFallback()` for their default elements when writing your own renderer.

## Plugins

```ts
import { formatHtml, Processor } from "@temelj/mdx";
import { HeadingIdPlugin, LowerHeadingPlugin, RemoveEsmPlugin } from "@temelj/mdx/plugins";

const processor = new Processor({
  documentPlugins: [new RemoveEsmPlugin()], // Run before HTML lowering or compilation.
  htmlPlugins: [
    new LowerHeadingPlugin({ offset: 1 }), // h1 -> h2.
    new HeadingIdPlugin({ prefix: "doc-" }), // Add heading IDs.
  ],
});

const source = "export const version = 1\n\n# Introduction";
const result = processor.processSync(source);
console.log(formatHtml(result.html));
// <h2 id="doc-introduction">Introduction</h2>

// Async plugins use the async methods. Pass a signal to cancel their work.
const controller = new AbortController();
await processor.process(source, { signal: controller.signal });
```

To write a document plugin, give it a name and a `transform()` method.
This one removes horizontal rules:

```ts
import type { DocumentPlugin } from "@temelj/mdx/plugins";

import { formatHtml, Processor } from "@temelj/mdx";

const removeDividers: DocumentPlugin = {
  name: "remove-dividers",
  transform({ rewrite }) {
    // Return a new tree; null removes the matching node.
    return rewrite({ thematicBreak: () => null });
  },
};

const processor = new Processor({ documentPlugins: [removeDividers] });
const result = processor.processSync("# Introduction\n\n---\n\nHello.");
console.log(formatHtml(result.html));
// <h1>Introduction</h1>
// <p>Hello.</p>
```

`transform()` runs document plugins.
`process()` also lowers HTML and runs HTML plugins.
`transform` and `process` also accept a `SourceFile` or an earlier parse result.
Their `Sync` variants reject async plugins.
Plugins return a tree or a promise.
Errors throw `TransformError` with the plugin name and stage.

`MathRenderPlugin` and `SyntaxHighlightPlugin` default to `mode: "tolerant"`.
If rendering fails, they keep readable content and add a warning.
Set `mode: "strict"` to throw on failure.

Find plugins in [./src/plugins](./src/plugins).

## Compile MDX without evaluating it

```ts
import { compile, Processor } from "@temelj/mdx";

const processor = new Processor({ syntax: { frontmatter: "yaml" } });
const parsed = await processor.transform("---\ntitle: Hello\n---\n\n# {6 * 7}");

// Generate JavaScript without running it.
const { artifact, frontmatter } = await compile(parsed);
console.log(artifact.code);
console.log(frontmatter); // { title: "Hello" }

// The default function-body artifact can cross a server/client boundary.
console.log(JSON.stringify(artifact));

// Build tools can request an ESM program instead.
const program = await compile(parsed, { outputFormat: "program" });
console.log(program.artifact.code);
```

`frontmatterSchema` accepts a Standard Schema validator (which can be declared with zod or another validation library).
Invalid data throws `FrontmatterError`.
HTML lowering options also apply to compilation, while HTML plugins do not.

Use [`compileTrustedMdx()`](../mdx-react/README.md#trusted-compilation) from @temelj/mdx-react in React when you intentionally want to evaluate trusted MDX.

## Compile MDX imports

The bundler plugin compiles imported `.mdx` files to components, without evaluating them.
With Vite, add it before React's plugin:

```ts
import { mdx, MdxConfig } from "@temelj/mdx/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    mdx({
      config: new MdxConfig({
        processor: { syntax: { frontmatter: "yaml" } },
      }),
    }),
    react(),
  ],
});
```

`MdxConfig` accepts `processor`, `compiler`, and `frontmatterSchema` options.
Document plugins run, while HTML plugins do not.

`?raw` and `?url` imports are left to Vite.
Other bundlers import the same `mdx` plugin from their own entry: `rollup-plugin`, `rolldown-plugin`, `webpack-plugin`, `rspack-plugin`, `rsbuild-plugin`, `esbuild-plugin`, `farm-plugin`, or `bun-plugin`.
For example, `import { mdx } from "@temelj/mdx/webpack-plugin"`.

## Stream a document

```ts
import { formatHtml, MdxStream, previewDocument } from "@temelj/mdx";

const stream = new MdxStream({ syntax: { math: "auto" } });

const preview = stream.append("Hello **wor");
console.log(formatHtml(previewDocument(preview)));
// The open strong emphasis is already visible in the preview.

stream.append("ld**.");
stream.edit({ start: 0, end: 5, text: "Hi" }); // Replace a source range.

const completed = stream.complete(); // Strict parse. No later appends or edits.
console.log(completed.document);
```

For repeated HTML output, attach a renderer to one stream:

```ts
import { HtmlStreamRenderer, MdxStream } from "@temelj/mdx";

const stream = new MdxStream();
const renderer = new HtmlStreamRenderer(stream);

stream.append("Hello **world**");
console.log(renderer.render()); // Whole current HTML snapshot.

stream.append(" and more.");
stream.complete();
console.log(renderer.render()); // Final HTML, with unchanged nodes cached.
```

When doing snapshots, replace the previous HTML snapshot and do not concatenate snapshots.
A later link or footnote definition can change an earlier block.

Appending stays cheap.

```ts
import { MdxStream } from "@temelj/mdx";

const stream = new MdxStream();
const before = stream.append("# Heading\n\nOpen paragraph");
const after = stream.append(" continues.");

// Settled blocks keep their identity while the open tail changes.
console.log(before.blocks[0] === after.blocks[0]); // true

// Read only the source range you need.
// file.text joins the whole document.
console.log(after.file.slice(after.blocks[0].origin));
```

An append parses the open tail again and reuses the settled blocks.
It decodes only new lines inside a "fence".
Changed definitions refresh the blocks that reference them (e.g like footnotes).

### Open syntax and "pending"

This feature allows declaring custom rendering for elements when they're pending.

When using React, you can set custom rendering function for a pending element.

```ts
import { MdxStream, ParseError } from "@temelj/mdx";

const stream = new MdxStream();
const preview = stream.append('<Alert title="Ready"');
console.log(preview.blocks); // Open JSX has state "pending"; nothing executes.

try {
  stream.complete(); // The JSX tag is still unfinished.
} catch (error) {
  if (!(error instanceof ParseError)) {
    throw error;
  }

  // Failed completion leaves the stream open for a repair.
  stream.append(" />");
  stream.complete();
}
```

| Preview node          | Rendering                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| `pending`             | Open emphasis, link, fence, math, or other syntax. `pendingFallback()` gives its provisional element. |
| `unresolvedReference` | Shows the reference source until its definition arrives.                                              |

Pending links are not clickable and pending images do not load.
Invalid syntax ideally stays local to its block.

### Subscribe to changes

```ts
import { MdxStream } from "@temelj/mdx";

const stream = new MdxStream();
const unsubscribe = stream.subscribe(({ snapshot, start, refreshed }) => {
  console.log(snapshot.blocks.slice(start)); // Replace the tail from this index.
  console.log(refreshed); // Earlier blocks updated by changed definitions.
  console.log(snapshot.footnotes); // The current footnote section.
});

stream.append("Read [the guide][guide].\n\n");
stream.append("[guide]: https://example.com\n"); // Refreshes the earlier reference.
unsubscribe();
```

### Stream trees from a server

```ts
import { streamBlockEvents } from "@temelj/mdx";

// The caller supplies decoded text chunks.
async function* jsonLines(chunks: AsyncIterable<string>): AsyncGenerator<string> {
  for await (const event of streamBlockEvents(chunks, { syntax: { math: "auto" } })) {
    yield `${JSON.stringify(event)}\n`;
  }
}
```

The generator ends with a `complete` event, or `failed` if MDX completion fails.
An upstream error rejects the iterator.
Serve the lines as `application/x-ndjson`.
On the client, `applyBlockEvent()` applies updates to a preview.

### Text from AI clients

```ts
import { MdxStream } from "@temelj/mdx";

async function parseAnswer(chunks: AsyncIterable<string>) {
  const stream = new MdxStream();

  for await (const text of chunks) {
    stream.append(text); // Render or publish the preview here.
  }

  return stream.complete(); // Run only after successful generation.
}

// AI SDK Core: await parseAnswer(result.textStream).
// OpenRouter Agent SDK: await parseAnswer(result.getTextStream()).
// OpenRouter chat SDK: yield each event's choices[0]?.delta?.content.
```

Pass decoded text only.
The SDK handles its wire protocol and reports provider errors.
Keep reasoning and tool events outside the MDX source, and pass your abort signal to the upstream request.

## Highlight code

Put JSON metadata after the fence language:

````md
```ts {"fileName":"worker.ts","highlightLines":"2,4-6","lineNumbers":true}
const worker = createWorker();
await worker.start();
```
````

````ts
import { formatHtml, Processor } from "@temelj/mdx";
import { createShikiHighlighter, SyntaxHighlightPlugin } from "@temelj/mdx/plugins";
import { createHighlighter } from "shiki"; // Optional application dependency.

const shiki = await createHighlighter({
  langs: ["typescript"],
  themes: ["github-light", "github-dark"],
});
const highlighter = createShikiHighlighter(shiki, {
  languageAliases: { ts: "typescript" },
  themes: { light: "github-light", dark: "github-dark" },
});
const processor = new Processor({
  htmlPlugins: [new SyntaxHighlightPlugin({ highlighter })],
});

const result = await processor.process("```ts\nconst answer = 42;\n```");
console.log(formatHtml(result.html)); // Shiki token spans and theme styles.
````

Use `parseCodeBlockMetadata()` to read metadata yourself.
Unknown fields remain in `metadata.raw`.
Your application should supply CSS for themes and line decorations.

## Use Unified plugins

It's possible to integrate plugins from "unified" ecosystem.

```ts
import { formatHtml, Processor } from "@temelj/mdx";
import { RehypePluginAdapter, RemarkPluginAdapter } from "@temelj/mdx/unified";
import rehypeSlug from "rehype-slug";
import remarkToc from "remark-toc";

const processor = new Processor({
  documentPlugins: [new RemarkPluginAdapter(remarkToc)], // MDX -> mdast -> MDX.
  htmlPlugins: [new RehypePluginAdapter(rehypeSlug)], // HTML -> hast -> HTML.
});

const result = await processor.process("# Contents\n\n# First section");
console.log(formatHtml(result.html));
```

## Diagnostics

```ts
import { formatDiagnostic, LimitError, parse, ParseError } from "@temelj/mdx";

try {
  parse("# Hello", { limits: { maximumSourceLength: 4 } });
} catch (error) {
  if (error instanceof ParseError || error instanceof LimitError) {
    for (const diagnostic of error.diagnostics) {
      console.error(formatDiagnostic(diagnostic)); // Location, severity, code, message.
    }
  } else {
    throw error; // Configuration errors are separate from content errors.
  }
}
```

Supported limits:

| Limit                       |                 Default |
| --------------------------- | ----------------------: |
| `maximumSourceLength`       |              16,777,216 |
| `maximumNestingDepth`       |                   1,024 |
| `maximumNodes`              |               1,000,000 |
| `maximumPendingBlockLength` | 4,194,304, streams only |

Source and pending-block lengths use UTF-16 code units.
Pass `limits` to `parse()`, `Processor`, or `MdxStream`.
`LimitError` also exposes `limit`, `maximum`, and `actual`. `hasErrorDiagnostics()` checks a diagnostic list.

## Entry points

| Import                 | Contents                                                          |
| ---------------------- | ----------------------------------------------------------------- |
| `@temelj/mdx`          | Parser, source files, trees, formatting, HTML, compiler, streams. |
| `@temelj/mdx/plugins`  | Plugin types, built-ins, code metadata, Shiki adapter.            |
| `@temelj/mdx/unified`  | Remark and rehype adapters.                                       |
| `@temelj/mdx/unplugin` | The unplugin instance behind the bundler plugins.                 |
| `@temelj/mdx/*-plugin` | Bundler plugins for MDX imports, such as `vite-plugin`.           |
| `@temelj/mdx/loader`   | Webpack and Turbopack loader.                                     |
