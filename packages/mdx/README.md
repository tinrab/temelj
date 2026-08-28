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
- exact source files, UTF-16 ranges, and immutable semantic nodes;
- a separate provisional tree for safe rendering while input is incomplete;
- a canonical MDX formatter and typed tree traversal;
- safe HTML lowering and a non-evaluating JSX compiler;
- native document and HTML plugins, plus optional Unified adapters.

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

Grammar recognizers do not mutate parser state while testing a candidate. They
report no match, a match, incomplete input at physical EOF, or invalid syntax.
Definitions, footnotes, ESM bindings, and diagnostics are committed only after
a match. One private Acorn boundary handles expressions, JSX expressions and
spreads, and ESM. Each embedded JavaScript range is parsed once, and Acorn ASTs
do not enter the public document model.

Streaming appends retain this block and inline state. Source edits roll back to
a private safe top-level checkpoint and parse the affected suffix. Checkpoint
density is an implementation detail, not a public tuning knob. Grammar scanning
is amortized linear across append-only input; edits scale with the reparsed
suffix and the reference or footnote consumers affected by it.

## Parse a complete document

`parse()` accepts a string or a `SourceFile` and returns a discriminated
`ParseOutcome`. Authored syntax errors and parser limits are values, not thrown
exceptions.

```ts
import { SourceFile, formatDiagnostic, parse } from "@temelj/mdx";

const file = new SourceFile({
  name: "article.mdx",
  text: "# Matrices\n\nMultiply **rows** by columns.",
});

const outcome = parse(file);

switch (outcome.kind) {
  case "parsed":
    console.log(outcome.document.toString());
    break;
  case "invalid":
  case "limitExceeded":
    for (const diagnostic of outcome.diagnostics) {
      console.error(formatDiagnostic(diagnostic));
    }
    break;
}
```

A parsed outcome contains the owned `SourceFile`, a strict `DocumentNode`, and
diagnostics. A strict document contains permanent semantic node classes such as
`HeadingNode`, `LinkNode`, `JsxFlowElementNode`, and `EsmNode`. It never contains
pending streaming states.

An invalid outcome always has at least one diagnostic. A limit outcome also
names the limit that stopped parsing. Invalid parser configuration, invalid
source offsets, and invalid edit ranges are caller errors and throw. Internal
invariant failures throw as defects.

## Source and ranges

`SourceFile` preserves the exact authored string. It does not normalize line
endings or replace source characters. Offsets are UTF-16 code-unit offsets, so
they match JavaScript string slicing and browser selection APIs.

```ts
const first = outcome.kind === "parsed" ? outcome.document.children[0] : undefined;

if (first?.origin !== undefined) {
  console.log(first.sourceText());
  console.log(first.origin.file.location(first.origin.start));
  console.log(first.origin.file.slice(first.origin));
}
```

One line index handles LF, CR, and CRLF. A byte-order mark is special only at
offset zero. Tabs advance to four-column stops when locations are calculated. A
NUL character reads semantically as U+FFFD through `character()` and
`semanticSlice()`, while `text`, `slice()`, and node origins still point to the
original NUL.

The default file name is `source.mdx`. Supplying a name gives diagnostics and
source maps a stable identity.

## Work with the semantic tree

Nodes are immutable. Parent nodes expose frozen `children`, leaf nodes expose
typed fields, and `with()` methods create replacements without mutating the
original tree.

Use `walkMdx()` for every node, `selectMdx()` for one kind, and `rewriteMdx()`
for structural changes. HTML trees have matching `walkHtml()`, `selectHtml()`,
and `rewriteHtml()` helpers.

```ts
import { selectMdx } from "@temelj/mdx";

if (outcome.kind === "parsed") {
  for (const { node } of selectMdx(outcome.document, "heading")) {
    console.log(node.depth, node.toString(), node.sourceText());
  }
}
```

These three text operations serve different jobs:

- `sourceText()` returns the exact authored slice when a node has an origin;
- `toString()` returns its semantic text content;
- `toSource()` formats the node as canonical MDX.

The formatter understands the enabled syntax and escapes characters that would
otherwise change meaning. Formatting options cover bullets, ordered markers,
emphasis, fences, quotes, rules, list indentation, definitions, footnotes, and
table layout.

```ts
if (outcome.kind === "parsed") {
  const formatted = outcome.document.toSource({
    bullet: "-",
    emphasis: "_",
    fence: "`",
    tableCellPadding: true,
  });
  console.log(formatted);
}
```

The document indexes the first definition and first footnote for each normalized
identifier. Use `document.definition(identifier)` and
`document.footnote(identifier)` to query the winning nodes. Parsed frontmatter
is available as `document.frontmatter?.data`; its node retains the authored
value for formatting and source inspection.

## Render inert HTML

`renderHtml()` lowers a strict document to an immutable `HtmlDocumentNode`.
Call `toHtml()` when a string is needed.

```ts
import { renderHtml } from "@temelj/mdx";

if (outcome.kind === "parsed") {
  const htmlDocument = renderHtml(outcome.document);
  console.log(htmlDocument.toHtml());
}
```

The default output boundary is deliberately inert:

- expressions become escaped authored text;
- ESM is omitted;
- JSX becomes a typed `HtmlJsxNode` with an escaped authored fallback;
- raw HTML is retained as `HtmlRawNode` and escaped by `toHtml()`;
- unsafe link and image URLs are removed;
- math remains a readable code fallback until a renderer handles it.

Pass `{ rawHtml: "trusted" }` to `toHtml()` only when the raw HTML is trusted.
Pass `{ allowUnsafeUrls: true }` to `renderHtml()` only when another layer owns
URL sanitization. By default, links accept `http`, `https`, `irc`, `ircs`,
`mailto`, and `xmpp`; images accept `http` and `https`.

Footnote references and the generated footnote section remain typed HTML nodes.
Render options can change the clobber prefix, labels, label tag, and backlink
text without changing the parsed document.

## Compile MDX without evaluating it

`compileMdx()` parses source, runs document plugins, validates optional
frontmatter, and emits JavaScript without executing the document. Its outcome
uses the same authored-error and resource-limit variants as the parser.

```ts
import { compileMdx } from "@temelj/mdx";

const outcome = await compileMdx(source, {
  outputFormat: "functionBody",
});

if (outcome.kind === "compiled") {
  console.log(outcome.artifact.code);
  console.log(outcome.frontmatter);
}
```

The default `functionBody` artifact contains plain transport data and no bare
imports. It can cross a server-function or loader boundary. Use
`outputFormat: "program"` for a normal ESM module intended for a build tool.
Authored imports remain ESM in program output. A function-body evaluator must
resolve them explicitly.

Pass `frontmatterSchema` to validate decoded frontmatter with Standard Schema.
A schema failure returns `kind: "invalid"` with `mdx.frontmatter.schema`
diagnostics. The typed outcome retains the schema result. The artifact contains
a separate frozen, plain-data copy suitable for framework transport; unsupported
values such as functions, cyclic data, and class instances return
`mdx.frontmatter.transport`. HTML plugins are not compiler plugins. Use document
plugins for semantic compilation and a runtime code-block component for
highlighting.

## Stream a document

`MdxStream` owns a mutable source and retains parser state across appends. Each
snapshot contains a `StreamingDocument`, top-level block snapshots, and current
diagnostics.

```ts
import { MdxStream, renderStreamingHtml } from "@temelj/mdx";

const stream = new MdxStream();

const beforeDefinition = stream.append("Read [the guide][guide].");
const paragraphId = beforeDefinition.blocks[0]?.id;

const afterDefinition = stream.append("\n\n[guide]: https://example.com/guide");

console.assert(afterDefinition.blocks[0]?.id === paragraphId);
console.log(renderStreamingHtml(afterDefinition.document));

const completion = stream.complete();
if (completion.kind === "parsed") {
  console.log(completion.document.toSource());
}
```

References are parsed independently from their definitions. Before `[guide]`
is defined, the paragraph contains a typed unresolved reference and renders as
authored text. Adding the definition rematerializes that dependent block as a
link without assigning a new block ID. Footnotes use the same dependency model
and maintain one live, document-wide footnote section.

Use `edit()` for UTF-16 source replacements:

```ts
const snapshot = stream.edit({
  start: 5,
  end: 10,
  text: "the kernel guide",
});
```

A valid edit always updates the owned source, even when the new state is invalid
or exceeds a limit. A later edit can repair it. An invalid range throws before
state changes.

Each top-level block has an opaque `BlockId`, its current source range, a
one-block document, and its reference and footnote dependencies. Identity
follows edit lineage:

| Change                             | Block ID result                            |
| ---------------------------------- | ------------------------------------------ |
| Append to the active block         | Preserved as the block grows and completes |
| Insert before an untouched block   | Preserved, with an updated range           |
| Replace text intersecting a block  | Reassigned for affected results            |
| Move or delete and reinsert source | Reassigned                                 |
| Change a winning definition        | Preserved for rematerialized consumers     |

This lets a renderer key top-level views by `BlockId` without tying identity to
an array index or a copy of the source string.

### Why streaming has its own tree

Incomplete input has states that cannot appear in a strict document. A code
fence may be open, a link destination may not have arrived, or a JSX tag may
have only a committed name and two attributes. Treating those states as strict
nodes would force compilers and plugins to handle values that disappear at EOF.

`StreamingDocument` therefore has its own discriminated node union. It is
immutable and traversable, but it cannot be formatted, compiled, processed by
plugins, or passed through Unified.

Committed streaming Markdown can expose typed complete or pending strong,
emphasis, strikethrough, code, fenced code, links, images, math, references, and
footnotes. Ambiguous marker-only prefixes stay authored text until their meaning
is known.

Pending executable syntax stays inert:

- a pending link is not clickable and a pending image does not load;
- pending math keeps readable authored content and does not call a renderer;
- pending JSX exposes only an exact committed name, complete quoted-string or
  boolean attributes, and safe Markdown children;
- JSX expressions and spreads never execute;
- pending expressions render as escaped authored text;
- pending ESM is omitted.

`renderStreamingHtml()` is the built-in safe string renderer. Applications can
also traverse the typed nodes and choose their own pending presentation without
weakening the parser's safety rules.

### Completion and recovery

`complete()` strictly finalizes the same parser session. A successful completion
is cached, idempotent, and terminal. Later appends and edits throw. Calling
`snapshot()` after success returns that cached completion.

An invalid or limit-exceeded completion is not terminal. The source remains
editable, so the caller can fix it and call `complete()` again. This distinction
matters for editors and interrupted streams, where an unfinished expression is
often temporary.

## Process documents with plugins

`Processor` combines strict parsing, document plugins, HTML lowering, and HTML
plugins. It returns a `ProcessOutcome` instead of throwing for authored parse
failures. It accepts a source string, a `SourceFile`, or an existing
`ParseOutcome`, so callers can process an already parsed document without
parsing it again.

```ts
import { Processor } from "@temelj/mdx";
import { HeadingIdPlugin, LowerHeadingPlugin, RemoveEsmPlugin } from "@temelj/mdx/plugin";

const processor = new Processor({
  syntax: { frontmatter: "auto", math: "auto" },
  documentPlugins: [new RemoveEsmPlugin()],
  htmlPlugins: [new LowerHeadingPlugin({ offset: 1 }), new HeadingIdPlugin({ prefix: "article-" })],
});

const result = processor.processSync("# Introduction");
if (result.kind === "processed") {
  console.log(result.value.document.toSource());
  console.log(result.value.html.toHtml());
}
```

Document plugins run on `DocumentNode` before HTML lowering. HTML plugins run
after lowering on `HtmlDocumentNode`. Both stages run in supplied order.
Subclass `DocumentTransformPlugin` or `HtmlTransformPlugin` to define a native
plugin, and use the context's `rewrite()` helper for immutable changes.

`process()` supports asynchronous plugins and an `AbortSignal`. `processSync()`
rejects an asynchronous plugin result. Processors accept strict input; render
provisional snapshots through the streaming tree instead.

The plugin entry point includes:

- `RemoveEsmPlugin` for deleting imports and exports from the semantic tree;
- `LowerHeadingPlugin` for shifting rendered heading levels;
- `HeadingIdPlugin` for unique heading IDs;
- `MathRenderPlugin` for a caller-supplied sync or async math renderer;
- `SyntaxHighlightPlugin` for provider-neutral fenced-code highlighting.

Math and syntax highlighting use typed fallback HTML nodes. In tolerant mode,
a provider failure leaves the readable fallback in place and adds a warning. In
strict mode, the provider error is thrown.

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
`{"start":20,"lines":"1-8"}`. Unknown JSON fields stay in `metadata.raw`, so a
provider can add its own behavior without changing the parser.

`SyntaxHighlightPlugin` accepts a provider-neutral `SyntaxHighlighter`.
Synchronous and asynchronous providers declare their kind in the type. Returning
`undefined` keeps the plain code block.

Shiki is an optional peer dependency. The adapter takes a caller-owned,
preloaded highlighter and does no loading or disposal itself:

````ts
import { Processor } from "@temelj/mdx";
import { SyntaxHighlightPlugin, createShikiHighlighter } from "@temelj/mdx/plugin";
import { createHighlighter } from "shiki";

const shiki = await createHighlighter({
  langs: ["text", "typescript"],
  themes: ["github-light", "github-dark"],
});

const highlighter = createShikiHighlighter(shiki, {
  languageAliases: { ts: "typescript" },
  themes: { light: "github-light", dark: "github-dark" },
  includeDataAttributes: ["language", "line-count"],
});

const processor = new Processor({
  htmlPlugins: [new SyntaxHighlightPlugin({ highlighter })],
});

try {
  const highlighted = processor.processSync('```ts {"lineNumbers":true}\nconst answer = 42;\n```');
  if (highlighted.kind === "processed") {
    console.log(highlighted.value.html.toHtml());
  }
} finally {
  shiki.dispose();
}
````

The Shiki adapter can add classes for highlighted, numbered, and command lines;
filename data; a line-number width custom property; and opt-in data attributes
for the language, line count, source code, and raw metadata.

## Use Unified plugins

Unified support is optional and lives at `@temelj/mdx/unified`. Remark adapters
run at the strict document stage, while rehype adapters run at the HTML stage.

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

The adapters convert owned trees to Unist and back around each transform. They
map VFile diagnostics to the original UTF-16 source, including CRLF input. They
reject Unified parser and compiler replacements because Temelj owns those
boundaries. Unified, Unist, MDAST, HAST, and VFile types are not part of the root
API.

## Limits and diagnostics

The default semantic parser limits are:

| Limit                       |               Default |
| --------------------------- | --------------------: |
| `maximumSourceLength`       |                16 MiB |
| `maximumNestingDepth`       |                 1,024 |
| `maximumNodes`              |             1,000,000 |
| `maximumPendingBlockLength` | 4 MiB for `MdxStream` |

Set parser limits with `parse(source, { limits })`, `new MdxStream({ limits })`,
or `new Processor({ parserLimits })`. The streaming pending-block limit is a
top-level `MdxStream` option because it applies only before strict completion.

Diagnostics carry a severity, stable code, message, optional exact source span,
notes, and related spans. Use `formatDiagnostic()` for plain text and
`hasErrorDiagnostics()` when a consumer needs a quick error check.

## Entry points

| Import                | Contents                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `@temelj/mdx`         | Source, parser, strict and streaming trees, formatter, HTML, compiler, processor, and traversal |
| `@temelj/mdx/plugin`  | Native plugin base classes, built-in plugins, code metadata, and the optional Shiki adapter     |
| `@temelj/mdx/unified` | Optional remark and rehype adapters                                                             |

Acorn ASTs, parser drafts, checkpoints, and other grammar state are private.
Public consumers work with source files, outcomes, semantic documents, and typed
streaming snapshots.
