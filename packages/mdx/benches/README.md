# MDX benchmarks

See [measured results](./RESULTS.md) for the complete comparison, including
slower cases and output differences.

Install and build workspace dependencies from the repository root, then run:

```sh
pnpm install
pnpm --filter @temelj/mdx... build
pnpm --filter @temelj/mdx bench
pnpm --filter @temelj/mdx bench:parse
pnpm --filter @temelj/mdx bench:html
pnpm --filter @temelj/mdx bench:compile
pnpm --filter @temelj/mdx bench:stream
pnpm --filter @temelj/mdx bench:verify
```

Inside `packages/mdx`, use `npm run bench`, etc. Every timing command rebuilds
Temelj before loading its `dist/` entry. All libraries run built ESM; tsx loads
the benchmark driver. Build time, imports, fixture loading, chunk slicing,
output checks, and source-map checks are outside measurement.

| Suite     | One timed operation                                                | Libraries                        |
| --------- | ------------------------------------------------------------------ | -------------------------------- |
| `parse`   | Source to native AST, read root child count                        | Temelj, MDX.js, remark, TanStack |
| `html`    | Source to HTML string, consume string                              | Temelj, remark, TanStack         |
| `compile` | Source to function-body JavaScript and source map, consume code    | Temelj, MDX.js                   |
| `stream`  | Fresh state, HTML at each update, completion, consume every string | Temelj, remark, TanStack         |

HTML and generated-code consumers read the last character as well as the
length, forcing lazy rope strings to flatten. The checksum is printed. Each
operation parses fresh source and constructs a new AST; configured remark and
MDX.js processors are reused. The stream tasks always create fresh state.

## Fixtures and measurement

Every suite includes the original synthetic workloads and **all six** unmodified
fixtures from TanStack's upstream benchmark corpus at a pinned revision.
See [fixture provenance](./fixtures/README.md). The corpus includes prose,
code, tables/lists, an AI response, and malformed Markdown. No fixture is
removed because Temelj loses or produces different output. Compilation also
includes the two MDX component fixtures and every Markdown fixture, rather than
selecting a subset. Streaming keeps the growing single-paragraph fixture,
which is particularly slow in Temelj.

Streaming runs with both 32 and 256 UTF-16 code units per update. All libraries
receive identical chunks and accumulated content. The result describes an
entire replay, including one final render, rather than one append. This measures
HTML string output; it does not measure React or reuse rendered strings for
unchanged blocks.

Tinybench warms each task for at least 200 ms and two iterations, then measures
at least 500 ms and eight samples by default. Tasks run sequentially in one
process. There are two rounds, with the second reversing library order to
reduce first/last bias. Each round remains visible in JSON. Even round counts
balance forward/reverse order; odd counts are marked `orderBalanced: false`.
Warmup, garbage collection, and CPU load can still affect results. A full run
can take several minutes. Repeat it without other CPU-heavy work before
interpreting small differences.

```sh
pnpm --filter @temelj/mdx bench:parse --time 2000 --rounds 4 --json /tmp/mdx-parse.json
pnpm --filter @temelj/mdx bench:stream --chunk-size 32,256 --json /tmp/mdx-stream.json

# Filter by substring of suite/fixture/chunk-size/library.
pnpm --filter @temelj/mdx bench --filter /tanstack/ --time 1000
pnpm --filter @temelj/mdx bench:stream --filter open-paragraph-128 --chunk-size 256

# Check output and source maps without recording timings.
pnpm --filter @temelj/mdx bench:verify --json /tmp/mdx-audit.json
```

JSON includes versions, CPU/runtime, input bytes, chunk sizes, round, update
count, mean/p50/p99 latency, margin of error, and samples. Invalid arguments,
empty selections, compilation errors, or a Temelj completion that differs from
its own batch output fail the command.

## What is comparable

The normal TanStack entry disables frontmatter extraction and heading IDs to
match the other libraries' configuration. The batch suites also run TanStack
with stock defaults. The stream suite runs both TanStack's recommended streaming
extension and its core renderer without that extension. Their names remain
separate in the output; do not choose whichever makes a preferred result win.
remark uses `remark-gfm` and `remark-html` with safe defaults. No HTML task uses
syntax highlighting or framework rendering.

`bench:verify` and every timed case audit HTML outside measurement. The reference
is remark's output, not Temelj's. The DOM comparison ignores class/style/alignment,
code language/meta attributes, block indentation, and one final code newline.
It retains text, tag structure, captions, destinations, titles, IDs, images,
and checkbox states. Raw output byte counts and SHA-256 digests remain visible.
This checks rendered structure, not full syntax conformance or equal AST features.

`finalMatch` checks the complete document. Streaming also records how many
intermediate updates match remark. `fullyMatched` is true only when the final
output and every preview match. Different preview policies, titled-code
captions, lists, and malformed syntax can produce different output. Those tasks
still run, but their timings are **native API comparisons**, not evidence of a
speed advantage for equivalent output. Output differences are printed before
timing and included in JSON. Never silently drop them or normalize away captions
or unfinished emphasis just to obtain a match.

Temelj retains source provenance, diagnostics, strict JavaScript validation,
and parser limits. Native ASTs have different structure and guarantees.
TanStack targets a smaller Markdown syntax profile; MDX.js parses executable
MDX. The main compiler rows both emit source maps. A separate MDX.js `no map`
row also measures its cheaper default without maps. Map granularity can differ;
Temelj additionally validates its generated JavaScript. Neither compiler
executes its output. remark and TanStack
do not compile MDX, so they have no compilation task. MDX.js is omitted from
streaming because its strict JSX/expression parser can reject incomplete input.

Upstream documentation: [Tinybench](https://github.com/tinylibs/tinybench),
[MDX.js](https://mdxjs.com/packages/mdx/), [remark](https://github.com/remarkjs/remark),
[TanStack Markdown](https://github.com/TanStack/markdown).
