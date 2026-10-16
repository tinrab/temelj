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
npm install @temelj/mdx
```

```sh
deno add jsr:@temelj/mdx
```

## What this package does

`@temelj/mdx` takes MDX from source text to output:

- **parse** complete files, streamed chunks, and edits with one grammar;
- **work with** plain, JSON-serializable document and HTML trees;
- **format** canonical MDX;
- **render** inert HTML, safe by default;
- **compile** to JavaScript without evaluating anything;
- **extend** with document and HTML plugins, or Unified adapters.

Parsing never runs code. JSX, expressions, and ESM are parsed but not executed, HTML output is
inert unless you opt in, and compilation only produces JavaScript. You decide where trusted
code is evaluated.

## The MDX dialect

The default dialect is CommonMark 0.31.2 with GFM (tables, task lists, strikethrough, literal
autolinks, footnotes) and MDX v3 (JSX, expressions, ESM). Optional syntax is enabled per call:

```ts
import { parse } from "@temelj/mdx";

const source = [
  "---",
  "title: Matrix multiplication",
  "---",
  "",
  "The tile area is $M \\times N$.",
  "",
  ":::note",
  "Start with a small tile.",
  ":::",
].join("\n");

const result = parse(source, {
  syntax: { directives: true, frontmatter: "auto", math: "auto" },
});
```

- `frontmatter`: `"yaml"`, `"toml"`, or `"auto"`.
- `math`: `"dollar"`, `"tex"`, or `"auto"`.
- `strikethroughMarkerCount`: `1` or `2`.

MDX syntax applies only where it is valid. `<` starts JSX only before a valid JSX prefix
(comments, declarations, and other HTML stay raw HTML), `{` starts an expression outside code,
and `import`/`export` start ESM only at a block boundary. As in MDX, JSX children on the
following lines are Markdown blocks and children on the same line are inline.

Unmatched Markdown delimiters are plain text. Invalid or unfinished JSX, expressions, and ESM
are errors, because quietly reinterpreting executable syntax would hide a mistake.

### How the parser works

A line-oriented block parser handles containers, lazy lines, and leaf blocks. It leaves
decisions such as "paragraph or Setext heading" open until the next line settles them. An
inline parser then reads each block's content ranges, which keep their mapping to the source
through list and quote prefixes, and resolves emphasis, links, code spans, and strikethrough
with delimiter and bracket stacks. Expressions, JSX, and ESM go through one private Acorn
boundary; no token stream or Acorn AST is exposed.

## Parse a complete document

`parse()` takes a string or a `SourceFile` and returns the file, the document, and any warning
diagnostics:

```ts
import { parse, SourceFile } from "@temelj/mdx";

const file = new SourceFile({ name: "article.mdx", text: "# Matrices\n\nMultiply **rows**." });
const { document, diagnostics } = parse(file);
```

Failures throw subclasses of `MdxError`: `ParseError` (with `file` and `diagnostics`) for
invalid syntax, and `LimitError` (with `limit`, `maximum`, and `actual`) when a limit is
exceeded. Invalid options, offsets, and edit ranges also throw.

## Work with the tree

Nodes are readonly plain objects with a `kind` discriminant, safe to serialize or send to a
client. `origin` is a `{ start, end }` range in the result's `file`.

```ts
import { formatMdx, nodeText, rewriteMdx, selectMdx } from "@temelj/mdx";

for (const { node } of selectMdx(result.document, "heading")) {
  console.log(node.depth, nodeText(node), node.origin && result.file.slice(node.origin));
}

const cleaned = rewriteMdx(result.document, {
  thematicBreak: () => null,
  image: ({ node }) => ({ ...node, url: node.url.replace(/\.png$/u, ".webp") }),
});

console.log(formatMdx(cleaned, { bullet: "-", emphasis: "_" }));
```

- `walkMdx`, `selectMdx`, and `rewriteMdx` traverse documents; `walkHtml`, `selectHtml`, and
  `rewriteHtml` traverse HTML trees.
- A rewrite handler returns `undefined` to keep a node, a node to replace it, or `null` to
  remove it. Phrasing handlers must return phrasing content and flow handlers flow content
  (`isPhrasingContent`, `isFlowContent`).
- `formatMdx` writes canonical MDX and escapes characters that would change meaning.
- `indexDocument` finds definitions and footnotes; `documentFrontmatter` returns the
  frontmatter node. TOML dates and times become `{ kind: "temporal", type, value }`.

## Render inert HTML

`lowerHtml()` turns a document into an HTML tree and `formatHtml()` serializes it:

```ts
import { formatHtml, lowerHtml } from "@temelj/mdx";

console.log(formatHtml(lowerHtml(result.document, { source: result.file })));
```

Output is inert by default:

- JSX and expressions become `jsx` and `expression` nodes that serialize as escaped source;
- ESM is dropped;
- raw HTML stays a `raw` node, which `formatHtml()` escapes unless given `rawHtml: "trusted"`;
- unsafe URLs are removed. Links allow `http`, `https`, `irc`, `ircs`, `mailto`, and `xmpp`,
  images allow `http` and `https`. Change this with `urlTransform`, or turn it off with
  `allowUnsafeUrls`.

Code blocks, math, and footnotes stay semantic nodes until rendered. `htmlFallback()` gives
their default element, which `formatHtml()` and the React renderer use.

## Process documents with plugins

`Processor` runs parsing, document plugins, HTML lowering, and HTML plugins:

```ts
import { formatHtml, Processor } from "@temelj/mdx";
import { HeadingIdPlugin, LowerHeadingPlugin, RemoveEsmPlugin } from "@temelj/mdx/plugins";

const processor = new Processor({
  syntax: { frontmatter: "auto", math: "auto" },
  documentPlugins: [new RemoveEsmPlugin()],
  htmlPlugins: [new LowerHeadingPlugin({ offset: 1 }), new HeadingIdPlugin({ prefix: "doc-" })],
});

console.log(formatHtml(processor.processSync("# Introduction").html));
```

`parse()` only parses. `transform()` also runs document plugins, and `process()` also lowers HTML
and runs HTML plugins. Both accept a source string, a `SourceFile`, or an earlier `ParseResult`,
take an `AbortSignal` in their options, and have `transformSync()`/`processSync()` variants that
reject async plugins.

A plugin is `{ name, transform(context) }` returning a new tree or a promise of one. The context
has the tree, the source file, a diagnostic reporter, the signal, and a `rewrite()` helper. An
error diagnostic or a thrown exception stops the pipeline with a `TransformError` naming the
plugin and stage.

Built-in plugins (`@temelj/mdx/plugins`): `RemoveEsmPlugin`, `LowerHeadingPlugin`,
`HeadingIdPlugin`, `MathRenderPlugin` (bring your own renderer), and `SyntaxHighlightPlugin`.
`MathRenderPlugin` and `SyntaxHighlightPlugin` run in `tolerant` mode by default, keeping the
fallback and adding a warning when rendering fails; `strict` mode throws instead.

## Compile MDX without evaluating it

`compile()` turns a parse or transform result into JavaScript, without running it:

```ts
import { compile, Processor } from "@temelj/mdx";

const processor = new Processor({ syntax: { frontmatter: "yaml" } });
const { artifact, frontmatter } = await compile(await processor.transform(source));
```

- The default `outputFormat: "functionBody"` is plain transport data with no bare imports, so
  it can cross a server or loader boundary. `"program"` emits an ESM module for build tools.
- Compiled output comes from the same lowered HTML as `lowerHtml()`, so lists, footnotes, and
  the URL policy match. `CompileOptions` accept the HTML options.
- `frontmatterSchema` validates frontmatter with Standard Schema; failures throw
  `FrontmatterError`.
- At runtime the content reads `props.components`: element overrides by tag, authored JSX
  components by name, and the reserved `codeBlock`, `mathFormula`, and `wrapper`.
  `@temelj/mdx-react` builds them with `compiledComponents()`.

## Stream a document

`MdxStream` parses a document as it arrives, such as a chat answer streamed token by token.
Appends reuse settled blocks and resume parsing the open tail:

```ts
import { formatHtml, MdxStream, previewDocument } from "@temelj/mdx";

const stream = new MdxStream({ syntax: { math: "auto" } });

stream.append("Read [the guide][guide].\n\n");
const preview = stream.append("[guide]: https://example.com\n\nMore **text");
console.log(formatHtml(previewDocument(preview)));

const { document } = stream.complete();
```

A preview snapshot holds the current `file`, the top-level `blocks`, the footnote section,
diagnostics, and a `limit` if one was exceeded. Each block has a stable `id`, its lowered HTML
`nodes`, a `status` (`"invalid"` blocks render their source as text), and `settled` once
later input cannot change it. `edit({ start, end, text })` replaces a source range, and
`snapshot()` returns the latest state.

For repeated HTML output, attach an `HtmlStreamRenderer` to the stream:

```ts
import { HtmlStreamRenderer, MdxStream } from "@temelj/mdx";

const stream = new MdxStream();
const renderer = new HtmlStreamRenderer(stream, { rawHtml: "escape" });

stream.append("Hello **world**");
console.log(renderer.render());
stream.append(" and more.");
console.log(renderer.render());
stream.complete();
console.log(renderer.render());
```

The renderer reuses serialized HTML for unchanged nodes across appends and edits.
It captures formatting options at construction and returns the strict document after
successful completion. Create a renderer for each stream. `formatHtml()` remains useful
for individual snapshots and caller-owned HTML trees.

### How appends stay cheap

Settled blocks are parsed, materialized, and lowered once, and keep their objects; each append
only re-finishes the open tail. Open paragraphs reuse completed inline tokens, open fences
decode only new lines, and growing lists reuse their leading items. Source
text lives in a shared, append-friendly buffer, and definitions, footnote numbers, and node
counts are running totals, so a settled block re-renders only when a definition it uses
changes. Unchanged nodes keep their identity, so renderers can skip them.

Paragraphs keep this work even without line endings. The parser retries the suffix
containing unfinished syntax or a trailing token. Source edits reset that continuation.
Text coalescing keeps node limits consistent with a fresh parse.

### Open syntax and missing references

Previews use the same HTML nodes as `lowerHtml()`, plus two preview-only kinds:

- `pending`: a construct that is still open (`strong`, `link`, `fence`, `inlineMath`, `jsx`, …)
  with its content so far. `pendingFallback()` gives its provisional element; pending links
  are not clickable and pending images do not load.
- `unresolvedReference`: a link, image, or footnote reference whose definition has not arrived
  yet. It shows its source until the definition resolves it.

Nothing executes during streaming, and open ESM renders nothing. A closed but invalid construct,
such as `{1+}`, invalidates only its block; exceeding a limit keeps the last valid blocks.

`complete()` finishes strictly and returns the document. Success is final; later appends and
edits throw. Failure throws `ParseError` or `LimitError` and leaves the stream open, so the
source can be fixed.

### Subscribe to changes

`subscribe()` reports each change: blocks before `start` are unchanged except the `refreshed`
ones whose definitions changed.

```ts
stream.subscribe(({ snapshot, start, refreshed }) => {
  send(snapshot.blocks.slice(start), refreshed);
});
```

### Stream trees from a server

Trees are plain data, so a server can parse and send blocks to a client that never parses.
`streamBlockEvents()` turns text chunks into update events and a final completion event, and
`applyBlockEvent()` applies an update on the client:

```ts
import { streamBlockEvents } from "@temelj/mdx";

for await (const event of streamBlockEvents(chunks, { syntax: { math: "auto" } })) {
  response.write(`${JSON.stringify(event)}\n`);
}
```

`@temelj/mdx-react` renders these events with `useMdxBlocks()`.

## Highlight fenced code

Fence metadata is a JSON object after the language:

````md
```ts {"fileName":"worker.ts","highlightLines":"2,4-6","lineNumbers":true}
const worker = createWorker();
await worker.start();
```
````

`highlightLines` and `commandLines` take `true` or one-based ranges like `"2,4-6"`; `lineNumbers`
takes `true` or `{ "start": 20, "lines": "1-8" }`. Other fields stay in `metadata.raw`.
`parseCodeBlockMetadata()` parses it directly.

`SyntaxHighlightPlugin` takes any `SyntaxHighlighter`. For Shiki (an optional peer
dependency), wrap a highlighter you created:

```ts
import { Processor } from "@temelj/mdx";
import { createShikiHighlighter, SyntaxHighlightPlugin } from "@temelj/mdx/plugins";
import { createHighlighter } from "shiki";

const shiki = await createHighlighter({
  langs: ["typescript"],
  themes: ["github-light", "github-dark"],
});

const highlighter = createShikiHighlighter(shiki, {
  languageAliases: { ts: "typescript" },
  themes: { light: "github-light", dark: "github-dark" },
});

const processor = new Processor({ htmlPlugins: [new SyntaxHighlightPlugin({ highlighter })] });
```

## Use Unified plugins

`@temelj/mdx/unified` runs remark plugins as document plugins and rehype plugins as HTML
plugins:

```ts
import { Processor } from "@temelj/mdx";
import { RehypePluginAdapter, RemarkPluginAdapter } from "@temelj/mdx/unified";
import rehypeSlug from "rehype-slug";
import remarkToc from "remark-toc";

const processor = new Processor({
  documentPlugins: [new RemarkPluginAdapter(remarkToc)],
  htmlPlugins: [new RehypePluginAdapter(rehypeSlug)],
});
```

Trees convert to Unist and back around each plugin, and VFile messages map to the original
source. Plugins that replace the parser or compiler are rejected.

## Limits and diagnostics

| Limit                       |              Default |
| --------------------------- | -------------------: |
| `maximumSourceLength`       |               16 MiB |
| `maximumNestingDepth`       |                1,024 |
| `maximumNodes`              |            1,000,000 |
| `maximumPendingBlockLength` | 4 MiB (streams only) |

Pass `limits` to `parse()`, `Processor`, or `MdxStream`. `maximumPendingBlockLength` caps the
longest top-level block that can still hold open syntax.

Diagnostics have a severity, a stable code, a message, and optional source spans and notes.
`formatDiagnostic()` renders one as text, and `hasErrorDiagnostics()` checks a list for errors.

## Entry points

| Import                | Contents                                                                   |
| --------------------- | -------------------------------------------------------------------------- |
| `@temelj/mdx`         | Source files, parser, trees, formatter, HTML, compiler, processor, streams |
| `@temelj/mdx/plugins` | Plugin contracts, built-in plugins, code metadata, the Shiki adapter       |
| `@temelj/mdx/unified` | Remark and rehype adapters                                                 |
