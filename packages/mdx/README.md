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

`@temelj/mdx` owns an MDX document from its first source character to its final
output. It provides:

- one incremental parser for complete files, appended chunks, and source edits;
- exact source files and plain, JSON-serializable semantic and HTML trees;
- streaming previews in the same HTML tree, with pending kinds for open syntax;
- a canonical MDX formatter and typed tree traversal;
- safe HTML lowering and a non-evaluating JSX compiler that renders the same
  elements as the HTML;
- document and HTML plugins, plus optional Unified adapters.

Batch parsing is not a second parser. `parse()` creates the same parser session
used by `MdxStream`, gives it the complete source, and strictly completes it.
The final result therefore does not depend on how streaming input was split into
chunks.

The package keeps parsing separate from execution. Parsing JSX, expressions, or
ESM does not run them. HTML output remains inert by default, and compilation
only produces JavaScript. The caller owns the boundary where trusted code is
evaluated.

## The MDX dialect

The default language combines CommonMark 0.31.2 with GFM tables, task lists,
strikethrough, literal autolinks, and footnotes. It also accepts MDX v3 JSX,
expressions, and ESM. CommonMark support includes indented code, raw HTML,
containers, lazy continuation lines, references, and the usual delimiter
precedence rules.

Optional syntax is enabled explicitly:

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
  syntax: {
    directives: true,
    frontmatter: "auto",
    math: "auto",
    strikethroughMarkerCount: 2,
  },
});
```

Frontmatter can be `"yaml"`, `"toml"`, or `"auto"`. Math can be `"dollar"`,
`"tex"`, or `"auto"`. The strikethrough marker count can be `1` or `2`.

MDX syntax takes precedence only where it is valid. A valid JSX prefix after
`<` starts JSX. HTML comments, declarations, CDATA, and other non-JSX HTML stay
raw HTML. An unescaped `{` starts an expression outside code, and `import` or
`export` starts ESM only at a valid flow boundary.

Like MDX, JSX and expressions decide their own content model. Children on the
lines after an opening tag are Markdown blocks; children on the same line are
inline content. A paragraph that contains only JSX and expressions does not
render a `p`, and a tag followed by more text on its line starts a paragraph.

Strict completion treats ordinary unmatched Markdown delimiters as authored
text. Closed but invalid MDX syntax is an error. Unfinished JSX, expressions,
or ESM are also errors because silently changing executable syntax would hide a
mistake.

### How the parser works

The parser has two direct grammar phases. A line-oriented block parser continues
containers, handles lazy lines, opens and closes containers, and advances the
active leaf. It keeps decisions such as a paragraph becoming a Setext heading
or table unresolved until another physical line settles them.

The inline parser then reads the physical content ranges that belong to each
block. Those ranges preserve their mapping through list and blockquote prefixes
and virtual indentation. One output sequence, a delimiter stack, and a bracket
stack resolve emphasis, links, images, code spans, and strikethrough directly.
There is no public token or event tree between the grammar and semantic nodes.

Grammar recognizers do not mutate parser state while testing a candidate. One
private Acorn boundary handles expressions, JSX, spreads, and ESM, including JSX
attribute values. Acorn ASTs do not enter the public document model.

## Parse a complete document

`parse()` accepts a string or a `SourceFile` and returns a `ParseResult`
containing the source file, document, and diagnostics. Invalid syntax throws
`ParseError`; exceeded limits throw `LimitError`.

```ts
import { parse, SourceFile } from "@temelj/mdx";

const file = new SourceFile({
  name: "article.mdx",
  text: "# Matrices\n\nMultiply **rows** by columns.",
});

const result = parse(file);

console.log(result.document.children.length);
```

Strict operations return successful values or throw errors extending `MdxError`.
`ParseError` carries `file` and `diagnostics`. `LimitError` also carries the
`limit`, configured `maximum`, and measured `actual` value when available.
Successful results retain warning and informational diagnostics.
Invalid configuration, offsets, and edit ranges also throw structured errors.

## Work with the tree

Nodes are plain, readonly objects with a `kind` discriminant. They can be
serialized, cached, or sent from a server to a client. `origin` is a
`{ start, end }` UTF-16 range in the result's `file`.

```ts
import { formatMdx, nodeText, selectMdx } from "@temelj/mdx";

for (const { node } of selectMdx(result.document, "heading")) {
  console.log(node.depth, nodeText(node));

  if (node.origin !== undefined) {
    console.log(result.file.slice(node.origin));
  }
}

console.log(formatMdx(result.document, { bullet: "-", emphasis: "_" }));
```

- `nodeText()` returns semantic text content.
- `file.slice(node.origin)` returns the exact authored source.
- `formatMdx()` formats canonical MDX for the enabled syntax and escapes
  characters that would otherwise change meaning.
- `indexDocument()` finds the first definition and footnote per identifier, and
  `documentFrontmatter()` returns the frontmatter node.

`walkMdx()`, `selectMdx()`, and `rewriteMdx()` traverse semantic trees;
`walkHtml()`, `selectHtml()`, and `rewriteHtml()` traverse HTML trees. Rewrite
handlers are keyed by kind. Returning `undefined` keeps a node, returning a node
replaces it, and returning `null` removes it. An MDX handler for phrasing content
may return any phrasing node, and one for flow content any flow node, so the tree
stays valid; `isPhrasingContent()` and `isFlowContent()` test the categories.
HTML handlers may return any node.

Frontmatter data is plain JSON-like data too. A TOML date or time is a
`{ kind: "temporal", type, value }` object with an ISO 8601 `value`.

```ts
import { rewriteMdx } from "@temelj/mdx";

const withoutBreaks = rewriteMdx(document, {
  thematicBreak: () => null,
  image: ({ node }) => ({ ...node, url: node.url.replace(/\.png$/u, ".webp") }),
});
```

## Render inert HTML

`lowerHtml()` lowers a document to an `HtmlRootNode`; `formatHtml()` serializes
it. Pass the source file so inert fallbacks keep authored text.

```ts
import { formatHtml, lowerHtml } from "@temelj/mdx";

const html = lowerHtml(result.document, { source: result.file });
console.log(formatHtml(html));
```

The output boundary is inert by default:

- expressions and JSX become typed `expression` and `jsx` nodes whose
  serialized form is their escaped authored source;
- ESM is omitted;
- raw HTML stays a `raw` node and `formatHtml()` escapes it unless
  `rawHtml: "trusted"` is set;
- unsafe link and image URLs are removed.

By default, links accept `http`, `https`, `irc`, `ircs`, `mailto`, and `xmpp`;
images accept `http` and `https`. `urlTransform(url, kind, sanitized)` replaces
that policy, and `allowUnsafeUrls` disables it.

Code blocks, math, footnote references, and the footnote section are semantic
kinds that keep their inputs. `htmlFallback()` returns their default element,
which `formatHtml()` and the React renderer use when nothing replaces them.

## Process documents with plugins

`Processor` combines parsing, document plugins, HTML lowering, and HTML plugins.

```ts
import { formatHtml, Processor } from "@temelj/mdx";
import { HeadingIdPlugin, LowerHeadingPlugin, RemoveEsmPlugin } from "@temelj/mdx/plugins";

const processor = new Processor({
  syntax: { frontmatter: "auto", math: "auto" },
  documentPlugins: [new RemoveEsmPlugin()],
  htmlPlugins: [new LowerHeadingPlugin({ offset: 1 }), new HeadingIdPlugin({ prefix: "article-" })],
});

const result = processor.processSync("# Introduction");

console.log(formatHtml(result.html));
```

- `parse()` parses with the processor's syntax and limits.
- `transform()` and `transformSync()` parse and run document plugins.
- `process()` and `processSync()` also lower HTML and run HTML plugins.

Transform and process methods accept a source string, a `SourceFile`, or an existing
`ParseResult`. The asynchronous methods accept an `AbortSignal`. Synchronous
methods throw a `ConfigurationError` for an asynchronous plugin.

A plugin is an object with a `name` and a `transform(context)` method that
returns a new tree or a promise of one. The context provides the current tree,
the source file, a diagnostic reporter, the signal, and a `rewrite()` helper. A
plugin that reports an error diagnostic stops the pipeline with `TransformError`.
The error carries the source file, diagnostics, stage, and plugin name. Thrown
plugin exceptions become `TransformError` with their original `cause`.

The plugin entry point includes:

- `RemoveEsmPlugin` for deleting imports and exports from the semantic tree;
- `LowerHeadingPlugin` for shifting rendered heading levels;
- `HeadingIdPlugin` for unique heading IDs;
- `MathRenderPlugin` for a caller-supplied sync or async math renderer;
- `SyntaxHighlightPlugin` for provider-neutral fenced-code highlighting.

In `tolerant` mode, a provider failure keeps the fallback and adds a warning. In
`strict` mode, the provider error is thrown. `parseCodeBlockMetadata()` returns
metadata directly or throws `CodeBlockMetadataError` with field issues and
partially parsed metadata. Tolerant highlighting uses that partial metadata.

## Compile MDX without evaluating it

`compile()` takes a parse or transform result, validates optional frontmatter,
and returns a `CompileResult` without executing JavaScript. The artifact type
follows `outputFormat`, including the default `functionBody` format.

```ts
import { compile, Processor } from "@temelj/mdx";

const processor = new Processor({ syntax: { frontmatter: "yaml" } });
const result = await compile(await processor.transform(source), {
  outputFormat: "functionBody",
});

console.log(result.artifact.code, result.frontmatter);
```

Compiled content is emitted from the same lowered HTML as `lowerHtml()`, so both
outputs share list tightness, footnote numbering and labels, and the URL policy.
`CompileOptions` include the HTML render options.

The default `functionBody` artifact contains plain transport data and no bare
imports, so it can cross a server-function or loader boundary. Use
`outputFormat: "program"` for an ESM module intended for a build tool.

Pass `frontmatterSchema` to validate decoded frontmatter with Standard Schema.
Schema failures throw `FrontmatterError` with `mdx.frontmatter.schema`
diagnostics and the original schema issues. Unsupported transport values, such
as functions, cyclic data, and class instances, throw `FrontmatterError` with
`mdx.frontmatter.transport` diagnostics and the reason.

At runtime, compiled content reads components from `props.components`
(`CompiledComponents`): element overrides by tag name, authored JSX components
by name, and the reserved `codeBlock`, `mathFormula`, and `wrapper` entries.
Any JSX runtime can provide them; `@temelj/mdx-react` maps its registry with
`compiledComponents()`.

Each ESM block is parsed once; its bindings, JSX, and exports come from that
parse. A function body receives the runtime as `__mdxRuntime`, resolves imports
through `__resolveMdxImport`, and returns its exports with the content as
`default`.

## Stream a document

`MdxStream` parses a document while it arrives, such as a chat answer streamed
token by token. Each append costs work proportional to the new text, not to the
document.

```ts
import { formatHtml, formatMdx, MdxStream, previewDocument } from "@temelj/mdx";

const stream = new MdxStream({ syntax: { math: "auto" } });

const before = stream.append("Read [the guide][guide].\n\n");
const after = stream.append("[guide]: https://example.com/guide\n\nMore **text");

console.assert(after.blocks[0]?.id === before.blocks[0]?.id);
console.log(formatHtml(previewDocument(after)));

const completion = stream.complete();

console.log(formatMdx(completion.document));
```

A snapshot has `kind: "preview"`, the current `file`, the top-level `blocks`,
the shared footnote section in `footnotes`, the diagnostics, and a `limit` when
the source exceeds one. `previewDocument()` joins a preview into one HTML tree.
`snapshot()` returns the current preview or the successful completion.

Each block is plain data:

- `id` is an opaque `BlockId` that survives appends and edits that do not touch
  the block;
- `nodes` is the block's lowered HTML;
- `status` is `"valid"`, or `"invalid"` for a block that renders its authored
  source as inert text;
- `settled` is `true` once later input can no longer change the block's syntax;
- `diagnostics` and `dependencies` list what the block reports and references.

### How appends stay cheap

The parser emits each top-level block once it settles. A settled block is
materialized and lowered once, and keeps its snapshot object afterwards. Every
append finishes only a copy of the open tail: a trailing list, the open
containers, and the active leaf.

- An open paragraph resumes its inline parse from the last line where nothing
  was left open. Its decoded text, parsed nodes, and rendered nodes before that
  line are reused in place, and a long paragraph's preview groups its children
  into fragments, so a snapshot copies only the changed end.
- An open fence decodes only the lines that arrived since the last append.
- A growing list reuses the materialized and lowered output of its leading
  items, so an append handles only the items that changed. The open list
  extends its arrays in place, and its preview groups children into fragments.
- The stream owns a `SourceBuffer`. Its files share text chunks, which merge
  like a binary counter, and one line index that scans each character once; an
  edit starts a new generation. The parser reads the chunks by offset, so a
  growing document is never copied whole.
- The parser grows the open leaf's line arrays in place. A tail draft's
  extensions are undone before the parser reads them again.
- Definitions, footnote numbers, node counts, and diagnostics are running
  totals. A settled block renders again only when a definition or footnote
  number it uses changes.

Each snapshot has a new `blocks` array, since snapshots are immutable; it holds
references to unchanged block objects. `subscribe()` reports which blocks
changed, for consumers that apply changes instead of reading whole snapshots.

Unchanged nodes keep their identity inside the open block too, so a renderer
can skip them. `pnpm --filter @temelj/mdx measure:streaming` reports per-append
p50, p95, and maximum latency for paragraphs, open paragraphs, open fences,
lists, containers, and late definitions at several sizes.

### Open syntax and missing references

Previews use the same `HtmlNode` union as `lowerHtml()`, plus two kinds that
only previews contain:

- `pending` is a construct that is still open, such as `strong`, `link`,
  `code`, `fence`, `inlineMath`, `displayMath`, `expression`, `esm`, or `jsx`.
  `children` holds the content so far as inert HTML, and `pendingFallback()`
  gives its provisional presentation. A pending link is not clickable and a
  pending image does not load.
- `unresolvedReference` is a link, image, or footnote reference whose
  definition has not arrived. It renders its authored source until the
  definition resolves it.

Open flow JSX with a committed name and literal attributes is a `jsx` node with
`state: "pending"` and its Markdown children so far. Expressions and spreads
never execute, and open ESM renders nothing. A bare list, heading, or quote
marker at the end renders nothing until content arrives.

A closed but invalid construct, such as `{1+}`, makes only its block invalid;
the rest of the document keeps streaming. Exceeding a limit keeps the last valid
blocks and sets `limit`. Block identities survive both states.

`complete()` finishes the tail strictly and assembles the document from the
settled blocks' nodes. Its blocks list the stream identities each block had. A
successful completion is cached and terminal; later appends and edits throw. A
failed completion throws `ParseError` or `LimitError` and leaves the stream
open, so the source can be repaired. Completed snapshots have `kind: "complete"`.

### Subscribe to changes

`subscribe()` reports what changed after each append or edit. Blocks before
`start` are the previous snapshot's objects, except the `refreshed` ones whose
definitions changed.

```ts
stream.subscribe(({ snapshot, start, refreshed }) => {
  send(snapshot.blocks.slice(start), refreshed);
});
```

### Stream trees from a server

Trees are plain data, so a server can run the stream and send blocks to a client
that never parses. `streamBlockEvents()` turns text chunks into update events and
a final completion event; `applyBlockEvent()` applies an update to the preview a
client holds.

```ts
import { streamBlockEvents } from "@temelj/mdx";

for await (const event of streamBlockEvents(chunks, { syntax: { math: "auto" } })) {
  response.write(`${JSON.stringify(event)}\n`);
}
```

An update event sends only the blocks from `start` on and the refreshed ones.
The completion event carries the completed document's HTML; pass `html` to
lower it through a `Processor` with HTML plugins. `@temelj/mdx-react` renders
these events with `useMdxBlocks()`.

## Highlight fenced code

Fence metadata is a JSON object after the language:

````md
```ts {"fileName":"worker.ts","highlightLines":"2,4-6","lineNumbers":true}
const worker = createWorker();
await worker.start();
```
````

`highlightLines` and `commandLines` accept `true` or one-based inclusive ranges
such as `"2,4-6"`. `lineNumbers` accepts `true` or an object such as
`{"start":20,"lines":"1-8"}`. Unknown fields stay in `metadata.raw`.

`SyntaxHighlightPlugin` accepts a provider-neutral `SyntaxHighlighter`. Shiki is
an optional peer dependency; the adapter takes a caller-owned, preloaded
highlighter:

```ts
import { Processor } from "@temelj/mdx";
import { createShikiHighlighter, SyntaxHighlightPlugin } from "@temelj/mdx/plugins";
import { createHighlighter } from "shiki";

const shiki = await createHighlighter({
  langs: ["text", "typescript"],
  themes: ["github-light", "github-dark"],
});

const highlighter = createShikiHighlighter(shiki, {
  languageAliases: { ts: "typescript" },
  themes: { light: "github-light", dark: "github-dark" },
});

const processor = new Processor({ htmlPlugins: [new SyntaxHighlightPlugin({ highlighter })] });
```

## Use Unified plugins

Unified support is optional and lives at `@temelj/mdx/unified`. Remark adapters
run as document plugins and rehype adapters as HTML plugins.

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

The adapters convert trees to Unist and back around each transform, and map
VFile diagnostics to the original source. Semantic HTML nodes reach rehype as
their fallback elements and return as semantic nodes when a plugin leaves them
unchanged. Unified parser and compiler replacements are rejected.

## Limits and diagnostics

| Limit                       |               Default |
| --------------------------- | --------------------: |
| `maximumSourceLength`       |                16 MiB |
| `maximumNestingDepth`       |                 1,024 |
| `maximumNodes`              |             1,000,000 |
| `maximumPendingBlockLength` | 4 MiB for `MdxStream` |

Set limits with `limits` on `parse()`, `Processor`, and `MdxStream`. Only a
stream accepts `maximumPendingBlockLength`, the longest top-level block that can
contain open syntax.
Diagnostics carry a severity, stable code, message, optional source span, notes,
and related spans. Use `formatDiagnostic()` for plain text and
`hasErrorDiagnostics()` for a quick error check.

## Entry points

| Import                | Contents                                                                          |
| --------------------- | --------------------------------------------------------------------------------- |
| `@temelj/mdx`         | Source, parser, trees, formatter, HTML, compiler, processor, stream, traversal    |
| `@temelj/mdx/plugins` | Plugin contracts, built-in plugins, code metadata, and the optional Shiki adapter |
| `@temelj/mdx/unified` | Optional remark and rehype adapters                                               |
