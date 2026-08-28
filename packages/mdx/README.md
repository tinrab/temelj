# @temelj/mdx

Temelj-owned MDX parsing, formatting, transforms, safe HTML rendering,
compilation, and incremental input.

The grammar includes CommonMark 0.31.2, GFM tables, task lists,
strikethrough, literal autolinks, footnotes, MDX JSX, expressions, and ESM.
Frontmatter, directives, and math are optional syntax settings.

## Parsing

`parse()` returns a discriminated outcome. Authored syntax and parser limits do
not throw.

```ts
import { parse } from "@temelj/mdx";

const outcome = parse("# Hello\n\n<Component value={count} />");
if (outcome.kind === "parsed") {
  console.log(outcome.document.toSource());
} else {
  console.error(outcome.diagnostics);
}
```

Pass a `SourceFile` to retain its name. Offsets use UTF-16 code units and refer
to the exact authored text.

```ts
import { parse, SourceFile } from "@temelj/mdx";

const file = new SourceFile({ text: "# Notes", name: "notes.mdx" });
const outcome = parse(file);
```

Parser limits are semantic: `maximumSourceLength`, `maximumNestingDepth`, and
`maximumNodes`. Invalid limit configuration throws because it is a programmer
error.

## Streaming

`MdxStream` owns its source. Append input or apply UTF-16 edits, inspect an
immutable provisional tree, then complete the same parser session.

```ts
import { MdxStream } from "@temelj/mdx";

const stream = new MdxStream();
stream.append("# Hel");
const snapshot = stream.append("lo");

for (const block of snapshot.blocks) {
  console.log(block.id, block.range, block.dependencies);
}

const completion = stream.complete();
if (completion.kind === "parsed") {
  console.log(completion.document.toSource());
}
```

Successful completion is cached and terminal. Failed completion remains
editable. An edit always updates the owned source unless its range is invalid.
`StreamingDocument` is a separate inert tree. Compiler, formatter, plugin, and
Unified APIs accept strict `DocumentNode` values only. Pending JSX exposes an
exact committed name, completed string or boolean attributes, safe Markdown
children, and no executable values. `renderStreamingHtml()` serializes the
provisional tree without executing expressions, spreads, math renderers, or ESM.
Safe pending Markdown nodes retain their exact authored spelling. Unresolved
link, image, and footnote references remain typed provisional nodes until their
definitions arrive; their block dependencies are recorded before resolution,
so adding, editing, or removing a winning definition rematerializes only its
consumers without changing their block IDs. Footnote references use one
document-wide order and one live footnote section while streaming.

## Processing

`Processor` returns `ProcessOutcome`. It has no streaming method because plugins
run only on strict documents.

```ts
import { Processor } from "@temelj/mdx";

const processor = new Processor({
  syntax: { directives: true, frontmatter: "auto", math: "auto" },
});
const outcome = await processor.process("# Hello");
if (outcome.kind === "processed") {
  console.log(outcome.value.document.toSource());
  console.log(outcome.value.html.toHtml());
}
```

Plugin APIs live at `@temelj/mdx/plugin`:

```ts
import { Processor } from "@temelj/mdx";
import { HeadingIdPlugin } from "@temelj/mdx/plugin";

const processor = new Processor({ htmlPlugins: [new HeadingIdPlugin()] });
```

Document plugins subclass `DocumentTransformPlugin`. HTML plugins subclass
`HtmlTransformPlugin`. `process()` supports asynchronous plugins and an
`AbortSignal`; `processSync()` rejects asynchronous plugins.

## Syntax highlighting

`SyntaxHighlightPlugin` accepts a provider-neutral `SyntaxHighlighter`. A
provider receives the exact code, its language, parsed metadata, and an optional
abort signal. Returning `undefined` keeps the plain code block. A highlighter
declares `kind: "synchronous"` when `highlight()` returns directly or
`kind: "asynchronous"` when it returns a promise.

Temelj recognizes JSON metadata after the fence language:

````md
```ts {"fileName":"worker.ts","highlightLines":"2,4-6","lineNumbers":true}
const worker = createWorker();
await worker.start();
```
````

Line selectors are one-based and inclusive. `lineNumbers` also accepts an
object such as `{"start":20,"lines":"1-8"}`. `commandLines` uses the same
boolean or selector-string form. Unknown JSON fields remain in the raw metadata
for provider-specific use.

The optional Shiki adapter is exported from `@temelj/mdx/plugin` and accepts a
caller-owned, preloaded Shiki instance:

```ts
import { Processor } from "@temelj/mdx";
import { SyntaxHighlightPlugin, createShikiHighlighter } from "@temelj/mdx/plugin";

const syntaxHighlighter = createShikiHighlighter(shiki, {
  languageAliases: { cuda: "c" },
  themes: { light: "github-light", dark: "github-dark" },
});
const processor = new Processor({
  htmlPlugins: [new SyntaxHighlightPlugin({ highlighter: syntaxHighlighter })],
});
```

The caller chooses the Shiki engine, languages, themes, and disposal lifetime.
The adapter is synchronous because it uses a preloaded Shiki instance. It can
add line classes, filename data, and opt-in language, line-count, source-code,
and raw-meta attributes.

## Optional syntax

Math accepts `"dollar"`, `"tex"`, or `"auto"`. Frontmatter accepts `"yaml"`,
`"toml"`, or `"auto"`. Directives use `directives: true`.

```ts
parse("$x$ and \\(y\\)", { syntax: { math: "auto" } });
parse("---\ntitle: Notes\n---", { syntax: { frontmatter: "yaml" } });
```

Decoded frontmatter is available on `document.frontmatter?.data`. The node's
`value` retains authored spelling for formatting. Invalid closed metadata stays
in the document with diagnostics and no decoded data.

## Rendering and compilation

`renderHtml` escapes raw HTML by default, emits JSX and expressions as authored
text, omits ESM, and filters URLs. `compile` emits a module but does not execute
it. `evaluateTrusted` requires a caller-owned module loader.

The `@temelj/mdx/unified` subpath adapts remark and rehype transforms. Unified,
Unist, MDAST, HAST, VFile, tokenizer data, and Acorn ASTs are not part of the
root API.
