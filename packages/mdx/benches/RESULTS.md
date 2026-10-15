# Performance and benchmark audit

Measured on 2026-10-15 with Node 26.11.1 on Linux x64, Intel Core Ultra 7 255HX.
These are local measurements. They do not establish a universal fastest library.
This report replaces the initial synthetic-only, source-based comparison.
See [the benchmark guide](./README.md) for the commands and workload definitions.

## Direct complete-document parsing

This pass starts from the implementation described below, including the previous
parser optimizations. `parse()` now drives the shared block parser directly,
without an editable session or edit checkpoints. It reuses the supplied source
file and its text, flattening only multi-chunk input, and resolves limits once.
Streaming retains its editable session; its unused batch completion method,
terminal state, and duplicate limit resolution are removed.
The grammar, materializer, strict validation, and public parsing API are shared.

Both implementations ran built ESM in the same process, using the existing
fixtures and workload definitions. Every task had 200 ms warmup, at least two
warmup iterations, 500 ms measurement, and at least eight samples. Rounds
alternate before/after order. Tables average the round means in milliseconds.
Parsing and HTML have four rounds pinned to CPU 5, a performance core;
compilation and streaming have two rounds without CPU affinity. The host has
active browser and indexing processes, so small differences remain uncertain.
No fixture is omitted. Compilation includes parsing and source-map generation;
streaming includes every preview and the final render at both chunk sizes.
The benchmark consumes AST child counts and reads HTML/generated strings through
the last character. Builds and verification commands ran separately from timing.

The baseline built-file SHA-256 is
`7155b79ef2e87db1170c910bc637e5cb688e0bcec804f770f7c67724b66a7966`.
Raw measurements and the comparison driver are available in
`/tmp/mdx-batch-ab.json` and `/tmp/mdx-batch-ab.mjs` in this workspace.
The driver reads `/tmp/mdx-batch-baseline.json` for the baseline build.
Run it from the repository root with `node --import tsx /tmp/mdx-batch-ab.mjs`.
Set `BATCH_SUITES=parse,html BATCH_ROUNDS=4` and use `taskset -c 5 node`
for the parsing/HTML run. Use
`BATCH_SUITES=compile,stream` for compilation/streaming. `BATCH_OUTPUT` chooses
the JSON destination.

The first implementation allocated another text wrapper for complete input. Its
initial two-round run made short-document parsing about 11% slower. The final
implementation reuses single-chunk text and only flattens multi-chunk files.
The initial measurements remain in `/tmp/mdx-batch-ab-initial.json`; all tables
below use fresh measurements after that change.

A separate four-round run of the final parsing/HTML implementation without CPU
affinity is retained in `/tmp/mdx-batch-ab-parse-html.json`. Results vary
substantially between those runs. Some pinned rounds have relative margins of
error above 30%, and the tables contain both gains and regressions. These
measurements do not establish a general throughput improvement. The concrete
overhead removal is verified separately: a sample document makes zero block
checkpoint calls after the change, versus 132 before, with identical HTML.

### Parsing and HTML

| Fixture               | Parse before | Parse after | HTML before | HTML after |
| --------------------- | -----------: | ----------: | ----------: | ---------: |
| short                 |       0.0097 |      0.0091 |      0.0305 |     0.0267 |
| article               |       0.3203 |      0.3257 |      0.6799 |     0.7749 |
| prose                 |       0.7265 |      0.7436 |      1.8438 |     1.8550 |
| references            |       0.3173 |      0.3772 |      0.8945 |     0.7499 |
| gfm                   |       1.1394 |      1.2669 |      3.1035 |     2.5969 |
| code                  |       0.4231 |      0.4151 |      0.5606 |     0.5452 |
| tanstack/ai-response  |       0.2646 |      0.2244 |      0.2631 |     0.2696 |
| tanstack/code-heavy   |       0.0549 |      0.0606 |      0.1316 |     0.1486 |
| tanstack/malformed    |       0.0184 |      0.0186 |      0.0575 |     0.0604 |
| tanstack/prose-heavy  |       0.0611 |      0.0624 |      0.2610 |     0.3236 |
| tanstack/small-doc    |       0.0387 |      0.0365 |      0.1285 |     0.1235 |
| tanstack/tables-lists |       0.1273 |      0.1172 |      0.2738 |     0.2559 |

### Compilation

| Fixture               | Before |  After |
| --------------------- | -----: | -----: |
| short                 | 0.0687 | 0.0695 |
| article               | 1.1525 | 1.1396 |
| prose                 | 4.0718 | 3.9660 |
| references            | 1.4748 | 1.4515 |
| gfm                   | 3.2226 | 3.1713 |
| code                  | 0.6204 | 0.5823 |
| tanstack/ai-response  | 0.2499 | 0.2582 |
| tanstack/code-heavy   | 0.2003 | 0.1866 |
| tanstack/malformed    | 0.0906 | 0.0938 |
| tanstack/prose-heavy  | 0.2201 | 0.2225 |
| tanstack/small-doc    | 0.2075 | 0.2015 |
| tanstack/tables-lists | 0.2947 | 0.2868 |
| component             | 0.1364 | 0.1298 |
| components            | 4.9704 | 4.8244 |

### Streaming

| Fixture               | Before, chunk 32 | After, chunk 32 | Before, chunk 256 | After, chunk 256 |
| --------------------- | ---------------: | --------------: | ----------------: | ---------------: |
| tanstack/ai-response  |            0.535 |           0.539 |             0.169 |            0.170 |
| tanstack/code-heavy   |            0.443 |           0.381 |             0.125 |            0.122 |
| tanstack/malformed    |            0.129 |           0.121 |             0.055 |            0.048 |
| tanstack/prose-heavy  |            1.222 |           1.218 |             0.345 |            0.284 |
| tanstack/small-doc    |            0.335 |           0.280 |             0.130 |            0.121 |
| tanstack/tables-lists |            0.658 |           0.624 |             0.257 |            0.221 |
| paragraphs-32         |            6.951 |           7.105 |             1.517 |            1.555 |
| open-paragraph-32     |           42.499 |          43.448 |             4.236 |            4.119 |
| fence-32              |            1.310 |           1.204 |             0.270 |            0.260 |
| list-32               |            7.237 |           6.861 |             2.029 |            1.967 |
| late-definitions-32   |            2.556 |           2.591 |             1.167 |            0.958 |
| paragraphs-128        |           79.791 |          77.050 |            13.637 |           13.734 |
| open-paragraph-128    |          922.939 |         823.973 |           104.068 |          111.568 |
| fence-128             |            7.440 |           6.761 |             1.329 |            1.376 |
| list-128              |           87.998 |          89.216 |            17.638 |           18.515 |
| late-definitions-128  |           17.702 |          17.678 |             5.934 |            5.774 |

Workspace build, typecheck, tests, lint, and formatting checks pass. The existing
204 MDX and 56 React tests are unchanged. A temporary differential check matched
10,808 parse cases across seven option configurations, 3,308 streaming updates
including edits, and 230 completion attempts against the baseline. It also checks
buffered source files, source locations, and the supplied file identity retained
by results and diagnostic spans. No repository tests were added.

## Previous parser improvements

The baseline is the worktree at the start of this pass, including the previous
optimizations. Both baseline and updated implementations ran built ESM in the
same process. Each fixture had two rounds with reversed before/after order,
200 ms warmup, and 500 ms measurement per task. Both versions consume AST child
counts and HTML strings. The table averages the two round means in milliseconds.
Every fixture is included, even near-ties.

| Fixture               | Parse before | Parse after | HTML before | HTML after |
| --------------------- | -----------: | ----------: | ----------: | ---------: |
| short                 |       0.0096 |      0.0090 |      0.0139 |     0.0122 |
| article               |       0.3026 |      0.2360 |      0.4074 |     0.3390 |
| prose                 |       0.8888 |      0.5902 |      1.2780 |     0.9761 |
| references            |       0.2770 |      0.2067 |      0.4840 |     0.4096 |
| gfm                   |       0.6340 |      0.5185 |      1.0239 |     0.9117 |
| code                  |       0.2035 |      0.1646 |      0.2149 |     0.1822 |
| tanstack/ai-response  |       0.0660 |      0.0647 |      0.0842 |     0.0764 |
| tanstack/code-heavy   |       0.0496 |      0.0515 |      0.0427 |     0.0398 |
| tanstack/malformed    |       0.0158 |      0.0137 |      0.0216 |     0.0193 |
| tanstack/prose-heavy  |       0.0791 |      0.0587 |      0.0968 |     0.0784 |
| tanstack/small-doc    |       0.0419 |      0.0363 |      0.0512 |     0.0471 |
| tanstack/tables-lists |       0.0679 |      0.0565 |      0.1030 |     0.0934 |

Prose parsing improved about 1.5x; several other workloads improved 10-35%.
AI-response parsing is nearly unchanged. Code-heavy parsing is about 4% slower
in this run, with high variance and opposite per-round directions; it is not a win.
Earlier shorter runs included noisy regressions, so these figures use a fresh
forward/reverse comparison after the final changes.

The changes remove unused reference/footnote sets from inline parsing, omit
pending-preview and resume-state construction during complete parsing, and
replace per-node singleton arrays and `flatMap` with direct materialization.
Physical line scanning uses native regular-expression searches rather than
checking every ordinary character in JavaScript. Source offsets, immutable
snapshots, parser limits, JavaScript validation, and diagnostics remain intact.

All 204 existing MDX tests and 56 existing React tests passed, along with the
workspace build, typecheck, and lint. A temporary differential check matched
1,230 sources under three limit configurations and 3,821 streaming/scanner
updates against the baseline. No new repository tests were added.

For identification, the baseline built `.mjs` files have SHA-256
`0daab5be7b64eadb2b6a3cad999666c5b91d36468ce0e5428949d629d4f7694e`.
The hash concatenates sorted relative filenames and file bytes, excluding
TypeScript declarations.

## Fairness findings

The initial suite used only our repeated synthetic inputs, fixed library order,
Temelj's TypeScript source against competitors' builds, and source maps only
for Temelj. It did not audit other renderers' output. Those numbers are superseded.

The current suite retains every original fixture and adds all six unmodified
TanStack benchmark fixtures at a pinned revision. It runs built JavaScript,
forward/reverse rounds, both 32- and 256-code-unit chunks, and source maps for
both compilers. TanStack's stock batch defaults and core streaming renderer
are measured alongside the configured comparisons. Every HTML string is
consumed, including flattening lazy ropes.

All HTML workloads are checked against remark outside timing. The comparison
ignores documented presentation details but keeps rendered text, structure,
code captions, destinations, titles, IDs, images, and checkbox states. Streaming
records intermediate matches as well as final matches. Raw bytes and hashes
remain available in JSON.

These checks found actual differences. TanStack renders code captions for
metadata that Temelj and remark treat as ordinary fence metadata. Some nested
lists, frontmatter defaults, and malformed syntax also differ. Temelj's pending
inline preview policy differs from remark and TanStack. Therefore the previous
list-stream speed ratio is not evidence of a speed advantage for equivalent
previews. Code-fence workloads do match at every update under the documented
normalization. No mismatching fixture is omitted or treated as a matched-work win.

## Expanded comparison

These cross-library timings predate the direct complete-document path above.
They remain here with their original output audits; use the before/after tables
above to assess this refactor.

The following tables include all fixtures and profiles, not just wins. They
average two forward/reverse rounds, with 200 ms warmup, 200 ms measurement,
and at least eight measured samples per task. Short measurements do not resolve
small differences reliably. Per-round error margins and p50/p99 values remain
in JSON. Commands used:

```sh
pnpm --filter @temelj/mdx bench --time 200 --json /tmp/mdx-full.json
pnpm --filter @temelj/mdx bench:compile --time 200 --json /tmp/mdx-compile.json
```

Compilation was rerun after adding the MDX.js no-map profile. Together the
current matrix contains 556 timing samples across 278 fixture/profile pairs,
plus 224 output-audit rows. Versions are MDX.js 3.1.1, remark 15.0.1 with
remark-gfm 4.0.1 and remark-html 16.0.1, TanStack Markdown 1.0.0, Tinybench 6.2.2,
and source-map 0.8.0. The auditor uses parse5 8.0.1.

### Native AST parsing

Mean milliseconds per parse. Every library builds its own AST with different
metadata and guarantees; this table is not an AST equivalence claim.

| Fixture               | Temelj | MDX.js + GFM | remark + GFM | TanStack configured | TanStack defaults |
| --------------------- | -----: | -----------: | -----------: | ------------------: | ----------------: |
| short                 |  0.009 |        0.111 |        0.102 |               0.003 |             0.003 |
| article               |  0.254 |        2.817 |        3.004 |               0.112 |             0.105 |
| prose                 |  0.617 |        9.385 |       10.048 |               0.165 |             0.167 |
| references            |  0.212 |        3.480 |        3.613 |               0.072 |             0.069 |
| gfm                   |  0.551 |        5.463 |        5.729 |               0.232 |             0.228 |
| code                  |  0.181 |        1.965 |        2.007 |               0.050 |             0.048 |
| tanstack/ai-response  |  0.047 |        0.567 |        0.545 |               0.026 |             0.026 |
| tanstack/code-heavy   |  0.031 |        0.276 |        0.259 |               0.010 |             0.011 |
| tanstack/malformed    |  0.014 |        0.134 |        0.133 |               0.004 |             0.004 |
| tanstack/prose-heavy  |  0.061 |        0.778 |        0.778 |               0.025 |             0.026 |
| tanstack/small-doc    |  0.033 |        0.323 |        0.314 |               0.016 |             0.016 |
| tanstack/tables-lists |  0.061 |        0.681 |        0.652 |               0.037 |             0.038 |

### HTML strings

Mean milliseconds. An asterisk marks final rendered content or structure that
differs from remark under the documented normalization. These values remain
visible but are not matched-output comparisons.

| Fixture               | Temelj | remark + GFM | TanStack configured | TanStack defaults |
| --------------------- | -----: | -----------: | ------------------: | ----------------: |
| short                 |  0.014 |        0.130 |               0.004 |            0.005* |
| article               |  0.364 |        3.340 |              0.149* |            0.152* |
| prose                 |  1.009 |       10.477 |               0.266 |             0.268 |
| references            |  0.445 |        3.823 |               0.120 |             0.113 |
| gfm                   |  0.840 |        6.911 |               0.337 |             0.332 |
| code                  |  0.169 |        1.911 |               0.048 |             0.047 |
| tanstack/ai-response  |  0.067 |        0.677 |               0.028 |            0.031* |
| tanstack/code-heavy   |  0.038 |        0.319 |              0.015* |            0.015* |
| tanstack/malformed    |  0.019 |        0.149 |              0.005* |            0.005* |
| tanstack/prose-heavy  |  0.073 |        0.875 |              0.026* |            0.028* |
| tanstack/small-doc    |  0.045 |        0.375 |              0.018* |            0.019* |
| tanstack/tables-lists |  0.081 |        0.760 |              0.040* |            0.040* |

### Compilation

Mean milliseconds. Both main columns emit source maps, while the third column
keeps MDX.js's cheaper no-map configuration visible. All MDX.js rows include
GFM. The compiler artifacts and source-map granularity differ. Short measurements can invert map/no-map ordering. Repeat with longer runs
before interpreting those differences.

| Fixture               | Temelj with map | MDX.js with map | MDX.js without map |
| --------------------- | --------------: | --------------: | -----------------: |
| short                 |           0.202 |           0.551 |              0.476 |
| article               |           1.766 |           5.835 |              5.719 |
| prose                 |           4.604 |          16.220 |             16.512 |
| references            |           1.875 |           7.959 |              8.346 |
| gfm                   |           3.318 |          10.497 |              9.866 |
| code                  |           0.754 |           2.416 |              2.266 |
| tanstack/ai-response  |           0.338 |           1.322 |              1.249 |
| tanstack/code-heavy   |           0.252 |           0.593 |              0.713 |
| tanstack/malformed    |           0.149 |           0.327 |              0.323 |
| tanstack/prose-heavy  |           0.256 |           1.272 |              1.237 |
| tanstack/small-doc    |           0.203 |           0.644 |              0.611 |
| tanstack/tables-lists |           0.340 |           1.214 |              1.178 |
| component             |           0.222 |           0.533 |              0.499 |
| components            |           6.966 |          10.531 |             10.065 |

### Streaming with 32-code-unit chunks

Each cell is `whole replay milliseconds [matching previews/updates]`. An
asterisk additionally marks a final-output mismatch. Equivalent-preview
comparisons require every update to match and no asterisk for both libraries.
remark is the reference and matches every update by definition. The TanStack
streaming and core profiles remain separate; neither is silently preferred.

| Fixture               |            Temelj | remark + GFM | TanStack streaming |     TanStack core |
| --------------------- | ----------------: | -----------: | -----------------: | ----------------: |
| tanstack/ai-response  |     0.513 [18/21] |        8.114 |      0.386 [20/21] |     0.375 [20/21] |
| tanstack/code-heavy   |     0.357 [32/32] |        6.590 |      0.329 [1/32]* |     0.346 [1/32]* |
| tanstack/malformed    |       0.105 [6/8] |        1.224 |       0.045 [2/8]* |      0.049 [2/8]* |
| tanstack/prose-heavy  |     1.110 [45/54] |       31.050 |      1.028 [1/54]* |     1.031 [1/54]* |
| tanstack/small-doc    |     0.263 [14/14] |        3.494 |      0.164 [4/14]* |     0.162 [4/14]* |
| tanstack/tables-lists |     0.597 [12/15] |        8.137 |      0.423 [9/15]* |     0.436 [9/15]* |
| paragraphs-32         |  12.062 [100/146] |      463.553 |   11.519 [146/146] |  18.379 [146/146] |
| open-paragraph-32     |   80.945 [96/144] |      315.086 |    7.256 [144/144] |   7.575 [144/144] |
| fence-32              |   1.374 [137/137] |       59.416 |    1.678 [137/137] |   1.750 [137/137] |
| list-32               |     8.024 [44/92] |      256.997 |     15.284 [84/92] |    15.600 [92/92] |
| late-definitions-32   |     2.216 [41/45] |       49.480 |      1.354 [45/45] |     1.312 [45/45] |
| paragraphs-128        |  73.274 [400/584] |     2932.503 |   76.908 [584/584] |  76.125 [584/584] |
| open-paragraph-128    | 755.681 [384/576] |     2572.446 |   60.474 [576/576] |  64.643 [576/576] |
| fence-128             |   5.400 [545/545] |      772.556 |   23.064 [545/545] |  25.545 [545/545] |
| list-128              |  88.992 [176/368] |     3765.960 |  220.218 [336/368] | 218.626 [368/368] |
| late-definitions-128  |  19.857 [161/177] |      729.066 |   18.124 [177/177] |  17.261 [177/177] |

### Streaming with 256-code-unit chunks

The same inputs, larger updates. These rows prevent conclusions that depend
only on tiny token-sized updates. The notation and matching requirements are
the same as above.

| Fixture               |         Temelj | remark + GFM | TanStack streaming |  TanStack core |
| --------------------- | -------------: | -----------: | -----------------: | -------------: |
| tanstack/ai-response  |    0.157 [3/3] |        2.005 |        0.094 [3/3] |    0.095 [3/3] |
| tanstack/code-heavy   |    0.100 [4/4] |        1.225 |       0.060 [0/4]* |   0.057 [0/4]* |
| tanstack/malformed    |    0.047 [1/1] |        0.312 |       0.012 [0/1]* |   0.011 [0/1]* |
| tanstack/prose-heavy  |    0.268 [6/7] |        5.509 |       0.178 [0/7]* |   0.178 [0/7]* |
| tanstack/small-doc    |    0.108 [2/2] |        0.933 |       0.048 [0/2]* |   0.048 [0/2]* |
| tanstack/tables-lists |    0.493 [2/2] |        8.946 |       0.463 [1/2]* |   0.428 [1/2]* |
| paragraphs-32         |  2.906 [15/19] |      118.214 |      3.253 [19/19] |  2.836 [19/19] |
| open-paragraph-32     |  4.085 [12/18] |       25.948 |      0.596 [18/18] |  0.617 [18/18] |
| fence-32              |  0.282 [18/18] |       10.568 |      0.280 [18/18] |  0.284 [18/18] |
| list-32               |   2.066 [6/12] |       42.471 |      2.316 [11/12] |  2.451 [12/12] |
| late-definitions-32   |    0.922 [6/6] |       10.397 |        0.304 [6/6] |    0.290 [6/6] |
| paragraphs-128        | 23.133 [50/73] |      941.805 |     20.260 [73/73] | 18.731 [73/73] |
| open-paragraph-128    | 86.265 [48/72] |      330.166 |      9.578 [72/72] |  8.453 [72/72] |
| fence-128             |  0.973 [69/69] |      103.493 |      2.864 [69/69] |  2.781 [69/69] |
| list-128              | 15.945 [22/46] |      528.161 |     30.189 [42/46] | 29.939 [46/46] |
| late-definitions-128  |  5.776 [21/23] |      121.419 |      3.044 [23/23] |  3.064 [23/23] |

In this earlier comparison, TanStack is faster in batch parsing and HTML output. Its upstream streaming
fixtures also favor TanStack in mean time, with some close cases. Temelj's large
code fence is a clear matched-output win: about 4.3x faster than the configured
TanStack streaming renderer at 32-code-unit updates, and about 2.9x at 256.
The small fence at 256 is tied. Long single-paragraph streams remain much slower
in Temelj. Growing-list results are native API timings because previews differ.
No universal speed ranking or winner-only aggregate is reported.
