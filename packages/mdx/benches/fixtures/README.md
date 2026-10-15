# Fixture provenance

`tanstack/*.md` contains every file from TanStack Markdown's
[`fixtures/benchmark`](https://github.com/TanStack/markdown/tree/d9b5ef7133ba514f7269cd8f29b5719cd34f5836/fixtures/benchmark)
at revision `d9b5ef7133ba514f7269cd8f29b5719cd34f5836`, copied without edits.
The upstream package declares the
[MIT license](https://github.com/TanStack/markdown/blob/d9b5ef7133ba514f7269cd8f29b5719cd34f5836/package.json).
The text is authored by TanStack's contributors. It includes their small docs,
prose, code, tables/lists, AI response, and malformed-input workloads.

Regenerate the files with `pnpm --filter @temelj/mdx bench:fetch-fixtures`.
The fetch script pins the revision and verifies each file's SHA-256 digest.
Benchmarks read the committed files and never access the network.

`../fixtures.ts` also defines Temelj's original synthetic workloads. Keep those
when adding realistic inputs, including workloads where Temelj loses.
