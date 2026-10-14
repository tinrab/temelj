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
- a separate provisional tree for safe rendering while input is incomplete;
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

const outcome = parse(source, {
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

`parse()` accepts a string or a `SourceFile` and returns a discriminated
`ParseOutcome`. Authored syntax errors and parser limits are values, not thrown
exceptions.

```ts
import { formatDiagnostic, parse, SourceFile } from "@temelj/mdx";

const file = new SourceFile({
  name: "article.mdx",
  text: "# Matrices\n\nMultiply **rows** by columns.",
});

const outcome = parse(file);

switch (outcome.kind) {
  case "ok":
    console.log(outcome.document.children.length);
    break;
  case "invalid":
  case "limitExceeded":
    for (const diagnostic of outcome.diagnostics) {
      console.error(formatDiagnostic(diagnostic));
    }
    break;
}
```

Every outcome in the package has the same shape: `kind: "ok"` with its result,
or `kind: "invalid" | "limitExceeded"` with at least one error diagnostic.
Invalid configuration, offsets, and edit ranges are caller errors and throw.

## Work with the tree

Nodes are plain, readonly objects with a `kind` discriminant. They can be
serialized, cached, or sent from a server to a client. `origin` is a
`{ start, end }` UTF-16 range in the outcome's `file`.

```ts
import { formatMdx, nodeText, selectMdx } from "@temelj/mdx";

if (outcome.kind === "ok") {
  for (const { node } of selectMdx(outcome.document, "heading")) {
    console.log(node.depth, nodeText(node));

    if (node.origin !== undefined) {
      console.log(outcome.file.slice(node.origin));
    }
  }

  console.log(formatMdx(outcome.document, { bullet: "-", emphasis: "_" }));
}
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
replaces it, and returning `null` removes it. MDX handlers keep the node kind;
HTML handlers may return any node.

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

if (outcome.kind === "ok") {
  const html = lowerHtml(outcome.document, { source: outcome.file });
  console.log(formatHtml(html));
}
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

if (result.kind === "ok") {
  console.log(formatHtml(result.html));
}
```

- `parse()` parses with the processor's syntax and limits.
- `transform()` and `transformSync()` parse and run document plugins.
- `process()` and `processSync()` also lower HTML and run HTML plugins.

Each method accepts a source string, a `SourceFile`, or an existing
`ParseOutcome`. The asynchronous methods accept an `AbortSignal`. Synchronous
methods throw a `ConfigurationError` for an asynchronous plugin.

A plugin is an object with a `name` and a `transform(context)` method that
returns a new tree or a promise of one. The context provides the current tree,
the source file, a diagnostic reporter, the signal, and a `rewrite()` helper. A
plugin that reports an error diagnostic has its result discarded. A thrown error
becomes a `TransformError` that names the stage and plugin.

The plugin entry point includes:

- `RemoveEsmPlugin` for deleting imports and exports from the semantic tree;
- `LowerHeadingPlugin` for shifting rendered heading levels;
- `HeadingIdPlugin` for unique heading IDs;
- `MathRenderPlugin` for a caller-supplied sync or async math renderer;
- `SyntaxHighlightPlugin` for provider-neutral fenced-code highlighting.

In `tolerant` mode, a provider failure keeps the fallback and adds a warning. In
`strict` mode, the provider error is thrown.

## Compile MDX without evaluating it

`compile()` takes a parse or transform outcome, validates optional frontmatter,
and emits JavaScript without executing it. A failed input is returned unchanged.

```ts
import { compile, Processor } from "@temelj/mdx";

const processor = new Processor({ syntax: { frontmatter: "yaml" } });
const outcome = await compile(await processor.transform(source), {
  outputFormat: "functionBody",
});

if (outcome.kind === "ok") {
  console.log(outcome.artifact.code, outcome.frontmatter);
}
```

Compiled content is emitted from the same lowered HTML as `lowerHtml()`, so both
outputs share list tightness, footnote numbering and labels, and the URL policy.
`CompileOptions` include the HTML render options.

The default `functionBody` artifact contains plain transport data and no bare
imports, so it can cross a server-function or loader boundary. Use
`outputFormat: "program"` for an ESM module intended for a build tool.

Pass `frontmatterSchema` to validate decoded frontmatter with Standard Schema.
A schema failure returns `kind: "invalid"` with `mdx.frontmatter.schema`
diagnostics. Values that cannot be transported, such as functions, cyclic data,
and class instances, return `mdx.frontmatter.transport`.

At runtime, compiled content reads components from `props.registry`: `html`
overrides by tag name, `jsx` components by name, `markdown.codeBlock`, and
`math`. `@temelj/mdx-react` defines that registry.

## Stream a document

`MdxStream` owns a mutable source and keeps parser state across appends and
edits. Every call returns a frozen preview.

```ts
import { formatMdx, MdxStream, renderStreamingHtml } from "@temelj/mdx";

const stream = new MdxStream();

const before = stream.append("Read [the guide][guide].");
const after = stream.append("\n\n[guide]: https://example.com/guide");

console.assert(after.blocks[0]?.id === before.blocks[0]?.id);
console.log(renderStreamingHtml(after.document));

const completion = stream.complete();

if (completion.kind === "ok") {
  console.log(formatMdx(completion.document));
}
```

A preview has `kind: "preview"`, the current `file`, top-level `blocks`, a
`supplement` holding the shared footnote section, the joined `document`, and
diagnostics. `snapshot()` returns the current preview or the successful
completion, discriminated by `kind`.

Each block has an opaque `BlockId`, its source range, a one-block document, and
its reference and footnote dependencies. Identity follows edit lineage:

| Change                             | Block ID result                            |
| ---------------------------------- | ------------------------------------------ |
| Append to the active block         | Preserved as the block grows and completes |
| Insert before an untouched block   | Preserved, with an updated range           |
| Replace text intersecting a block  | Reassigned for affected results            |
| Move or delete and reinsert source | Reassigned                                 |
| Change a winning definition        | Preserved for rematerialized consumers     |

Unchanged blocks keep their snapshot object, so a renderer can compare blocks by
identity and key views by `BlockId`.

### Incomplete and invalid input

Incomplete input has states that cannot appear in a strict document, so
previews use their own `StreamingNode` union. It can be traversed and rendered
but not formatted, compiled, or processed by plugins.

- Unfinished emphasis, code, links, images, math, and fences are typed pending
  nodes. A pending link is not clickable and a pending image does not load.
- Unfinished inline JSX and expressions are pending nodes, not errors.
- Pending JSX exposes only a committed name, complete literal attributes, and
  safe Markdown children, which render as blocks when they start on a new line.
- Expressions and spreads never execute, and pending ESM is omitted.
- A bare list, heading, or quote marker at the end renders nothing until content
  arrives.

A closed but invalid construct, such as `{1+}`, makes only its block invalid.
That block renders as inert authored text, its diagnostics are reported, and the
rest of the document keeps streaming with `status: "invalid"`. Exceeding a limit
keeps the last valid preview with `status: "limitExceeded"`. Block identities
survive both states.

`complete()` strictly finalizes the session. A successful completion is cached,
idempotent, and terminal; later appends and edits throw. A failed completion is
not terminal, so the source can be repaired and completed again.

### Cost

Appends reuse settled blocks by parser output identity, and an open container
such as a growing list materializes, lowers, and converts only its changed
items. A typical 20 KB answer streamed in 32-character chunks costs well under a
millisecond per append. Very large documents still pay a small per-block cost on
each append.

Run `pnpm --filter @temelj/mdx measure:streaming` for per-append p50, p95, and
maximum latency on generated paragraphs, open fences, lists, containers, and
late definitions at several sizes.

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

Set parser limits with `limits` on `parse()`, `Processor`, and `MdxStream`.
Diagnostics carry a severity, stable code, message, optional source span, notes,
and related spans. Use `formatDiagnostic()` for plain text and
`hasErrorDiagnostics()` for a quick error check.

## Entry points

| Import                | Contents                                                                          |
| --------------------- | --------------------------------------------------------------------------------- |
| `@temelj/mdx`         | Source, parser, trees, formatter, HTML, compiler, processor, stream, traversal    |
| `@temelj/mdx/plugins` | Plugin contracts, built-in plugins, code metadata, and the optional Shiki adapter |
| `@temelj/mdx/unified` | Optional remark and rehype adapters                                               |
