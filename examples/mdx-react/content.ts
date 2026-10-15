export const mdxSyntax = {
  directives: true,
  frontmatter: "auto",
  math: "auto",
} as const;

export const dynamicMdxSource = `---
title: Safe dynamic MDX rendering
draft: false
tags:
  - markdown
  - react
---

# Safe dynamic MDX rendering

This editor renders MDX without executing authored JavaScript. You can change the source and inspect the result immediately, while expressions, spreads, and ESM remain inert.

## Text and links

Plain text can contain **strong emphasis**, *emphasis*, ~~deleted text~~, and \`inline code\`. It can link to [the MDN Markdown guide](https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Howto/Markdown_in_MDN "Markdown on MDN") or turn https://example.com into an autolink.

This line ends with an explicit break.\\
The next sentence should begin on a new line without starting a new paragraph.

> A block quote can contain **formatted text**.
>
> It can also contain more than one paragraph.

---

## Lists and tasks

- An unordered item
- A nested list
  - Child one
  - Child two
- [x] A completed task
- [ ] An open task

1. First ordered item
2. Second ordered item
   1. Nested ordered item

## Table

| Feature | Input | Expected result |
| :--- | :---: | ---: |
| Alignment | left | right |
| Inline code | \`const x = 1\` | preserved |
| Escaping | *literal asterisks* | visible |

## Image and references

![Vite logo](/logo.svg "A local SVG served by Vite")

This [reference link][reference] and its definition exercise association lookup.

[reference]: https://github.com/tinrab/ "GitHub"

## Footnotes

A short statement can carry a footnote.[^short] Reusing it should add another backreference.[^short]

[^short]: Footnotes may contain **formatted text** and links.

## Directives

An inline :status[directive]{state=ready} appears inside a paragraph.

::notice[Leaf directive]{severity=info}

:::callout[Container directive]{tone=warning}
The container has a paragraph, \`code\`, and a list.

- First child
- Second child
:::

## Math delimiters

Dollar math renders inline as $E = mc^2$. TeX delimiters work in the same document as \\(a^2 + b^2 = c^2\\).

Caller-defined KaTeX macros work too: $x \\in \\RR$.

$$ fourier-transform
\\hat{f}(\\xi) = \\int_{-\\infty}^{\\infty} f(x)e^{-2\\pi i x\\xi} \\, dx
$$

\\[
\\sum_{k=1}^{n} k = \\frac{n(n + 1)}{2}
\\]

Malformed math stays readable instead of breaking the page: $\\frac{$.

## Code blocks

\`\`\`c { "fileName": "math.c", "highlightLines": "10", "lineNumbers": true }
float Q_rsqrt( float number )
{
	long i;
	float x2, y;
	const float threehalfs = 1.5F;

	x2 = number * 0.5F;
	y  = number;
	i  = * ( long * ) &y;                       // evil floating point bit level hacking
	i  = 0x5f3759df - ( i >> 1 );               // what the fuck?
	y  = * ( float * ) &i;
	y  = y * ( threehalfs - ( x2 * y * y ) );   // 1st iteration
//	y  = y * ( threehalfs - ( x2 * y * y ) );   // 2nd iteration, this can be removed

	return y;
}
\`\`\`

    Indented code remains a code block too.

\`\`\`bash { "commandLines":"1" }
echo "Hello, World!"
Hello, World!
\`\`\`

## The executable parts stay inert

Raw HTML is displayed safely instead of being injected: <mark>highlighted by authored HTML</mark>.

The expression below remains authored text. It does not turn into the number four:

{2 + 2}

Registered components can render when their names and literal properties are known:

<Alert title="Safe component" description="This component uses completed literal properties. No authored JavaScript ran." />

<Note title="Markdown children are safe too">
  The renderer can pass parsed Markdown children to a registered component without evaluating expressions or spreads.
</Note>

export const hiddenFromRenderedHtml = 42

The export above belongs to the parsed document, but this renderer omits it instead of executing it.
`;

export const compiledMdxSource = `---
title: Trusted compiled MDX
draft: false
---

export const answer = 6 * 7
export const language = "MDX"

# Trusted compiled MDX

This page takes a different path from the dynamic editor. The server parses and compiles trusted MDX, evaluates the generated module, checks the outcome, and then renders the resulting React component.

## Expressions execute

Because this source is trusted, JavaScript expressions run. The exported value \`answer\` is available to the document, so \`{answer}\` renders as **{answer}**.

Expressions can also build ordinary text: Welcome to **{language} compilation**.

<Alert title="Trusted execution" description="This registered component was created by evaluated MDX on the server." />

## Markdown still behaves normally

Compilation keeps the same Markdown structure, source ranges, math nodes, and footnotes as strict parsing. For example, the area of a circle is $A = \\pi r^2$.[^runtime]

[^runtime]: Compilation produces JavaScript, while the application still owns component registration and the KaTeX renderer.

:::note[Compiler boundary]{mode=trusted}
Directives remain semantic content and compile to ordinary React elements with literal attributes.
:::

## Code blocks use the registry

The compiled document sends code-block metadata to the same registered renderer used elsewhere in the demo.

\`\`\`ts {"fileName":"answer.ts","lineNumbers":true,"highlightLines":"2"}
export function calculateAnswer(): number {
  return 6 * 7;
}
\`\`\`

Use trusted compilation only for MDX that is allowed to execute. External or user-authored content should use the dynamic safe renderer instead.
`;

export const streamedMdxChunks = [
  "# Build a matrix multiplication kernel from scratch\n\n",
  "Matrix multiplication is a useful first CUDA project. The arithmetic is familiar, and a basic kernel takes only a few lines. Making it faster teaches you why memory access matters as much as the multiplication itself.\n\n",
  "We will write a straightforward kernel first. Once it produces the right answers, we will reduce repeated global-memory reads by loading small tiles into shared memory.\n\n",
  "<Ale",
  'rt title="Correctness comes first" ',
  'description="Keep a CPU implementation beside the kernel and compare every output while the matrices are small. A fast kernel with one bad edge tile is still a broken kernel." />\n\n',
  "## Give each thread one answer\n\n",
  "Let $A$ have shape $M \\times K$ and $B$ have shape $K \\times N$. Their product $C$ has shape $M \\times N$, with each entry computed as\n\n$$\nC_{ij} = \\sum_{p=0}^{K-1} A_{ip}",
  "B_{pj}.\n$$\n\n",
  "The simplest CUDA mapping gives one output value to each thread. The thread chooses a row and column, walks across the shared $K$ dimension, and writes the result to `C`.\n\n",
  '```c {"fileName":"matmul.cu","lineNumbers":true}\n__global__ void matmul_naive(\n    const float* A, const float* B, float* C,\n    int M, int N, int K) {\n',
  "  const int col = blockIdx.x * blockDim.x + threadIdx.x;\n  const int row = blockIdx.y * blockDim.y + threadIdx.y;\n\n",
  "  if (row >= M || col >= N) return;\n\n  float sum = 0.0f;\n  for (int p = 0; p < K; ++p) {\n    sum += A[row * K + p] * B[p * N + col];\n  }\n",
  "  C[row * N + col] = sum;\n}\n```\n\n",
  '<Note title="Read the indices before the code">\n',
  "`A[row * K + p]` walks across one row of `A`. `B[p * N + col]` walks down one column of `B`. If either stride is wrong, the kernel can return plausible nonsense.\n",
  "</No",
  "te>\n\n",
  "Launch a two-dimensional grid so neighboring `threadIdx.x` values own neighboring columns of `C`. That detail matters because a warp groups consecutive thread IDs. Those threads should read or write consecutive addresses whenever possible.\n\n",
  "<Ale",
  'rt title="Coalescing starts with thread assignment" ',
  'description="Within a warp, threadIdx.x changes fastest. Mapping that index to the output column lets neighboring threads write neighboring floats and read neighboring values from B." />\n\n',
  "## Stop fetching the same values\n\n",
  "The first kernel is correct, but it asks global memory for the same values again and again. Threads in one block need many of the same entries from `A` and `B`. Shared memory lets them load those entries together and reuse them.\n\n",
  "Split the matrices into square tiles. Every thread loads one value from `A` and one from `B`, waits for the tile to fill, then reuses those values for several multiply-adds.\n\n",
  '```c {"fileName":"matmul-tiled.cu","highlightLines":"8-11","lineNumbers":true}\ntemplate<int TILE>\n__global__ void matmul_tiled(\n    const float* A, const float* B, float* C,\n    int M, int N, int K) {\n',
  "  __shared__ float tileA[TILE][TILE];\n  __shared__ float tileB[TILE][TILE];\n\n  const int row = blockIdx.y * TILE + threadIdx.y;\n  const int col = blockIdx.x * TILE + threadIdx.x;\n  float sum = 0.0f;\n\n",
  "  for (int base = 0; base < K; base += TILE) {\n    const int aCol = base + threadIdx.x;\n    const int bRow = base + threadIdx.y;\n\n    tileA[threadIdx.y][threadIdx.x] =\n        row < M && aCol < K ? A[row * K + aCol] : 0.0f;\n",
  "    tileB[threadIdx.y][threadIdx.x] =\n        bRow < K && col < N ? B[bRow * N + col] : 0.0f;\n\n    __syncthreads();\n\n    #pragma unroll\n    for (int p = 0; p < TILE; ++p) {\n      sum += tileA[threadIdx.y][p] * tileB[p][threadIdx.x];\n    }\n\n",
  "    __syncthreads();\n  }\n\n  if (row < M && col < N) {\n    C[row * N + col] = sum;\n  }\n}\n```\n\n",
  "The first barrier protects readers from a half-filled tile. The second protects them from eager threads overwriting that tile for the next pass.[^barriers]\n\n",
  "[^barriers]: Every thread in the block must reach both barriers. That is why the bounds checks zero-fill shared memory instead of returning early.\n\n",
  "<Alert title=",
  '"Do not return before a block-wide barrier" ',
  'description="If some threads leave while others call __syncthreads, the block can hang. Handle edge tiles during the loads and guard only the final store." />\n\n',
  "## Make each thread do more\n\n",
  "Shared-memory tiling fixes reuse between threads, but one output per thread still spends many instructions moving values around. The next useful step is register blocking. Give each thread a small strip or rectangle of `C` and keep those partial sums in registers. One loaded value can then feed several accumulators.\n\n",
  "| Version | Each thread computes | Main gain |\n| :-- | :-- | :-- |\n",
  "| Naive | One output | A correct baseline |\n",
  "| Shared tile | One output | Reuse across the block |\n",
  "| Register block | Several outputs | More math per shared-memory load |\n\n",
  "Tile size is a tradeoff. Larger tiles reuse more data, but they also consume more shared memory and registers. Too much of either can leave fewer blocks running on each SM. Try a few small configurations and measure them instead of guessing.\n\n",
  '<QuietNote title="Measure each kernel separately" ',
  "/>\n\n",
  "## Test before chasing throughput\n\n",
  "Start with awkward dimensions such as $M=37$, $N=53$, and $K=29$. Multiples of the tile size are friendly enough to hide broken edge handling. Random inputs help too, but I also keep one tiny matrix that I can work out by hand.\n\n",
  "- [x] Compare the naive kernel with a CPU result.\n- [x] Test dimensions smaller than one tile.\n",
  "- [x] Test dimensions with partial tiles in all three axes.\n- [ ] Time the tiled kernel only after those cases pass.\n\n",
  "Use CUDA events around repeated launches, discard warm-up runs, and report the matrix sizes with the timing. A single duration without the shapes is not a result. For an $M \\times K$ by $K \\times N$ product, the usual throughput estimate is\n\n$$\n\\text{FLOP/s} \\approx \\frac{2MKN}{t}.\n$$\n\n",
  "Once the tiled kernel is solid, try giving each thread several outputs. After that, experiment with vectorized loads and different tile shapes. Change one thing at a time, and keep the previous correct kernel so you always have something trustworthy to compare against.\n\n",
] as const;

export const streamedMdxSource = streamedMdxChunks.join("");

export function streamDelayMilliseconds(content: string): number {
  return content.startsWith('description="') ? 2_000 : 500;
}

/** Canned assistant answers for the chat example, streamed as small token-sized chunks. */
export const chatAnswers = [
  `Streaming Markdown well means **not re-parsing** the whole message for every token.

1. Settled blocks keep their identity.
2. Only the open tail renders again.
3. Code keeps a stable component:

\`\`\`ts
const stream = new MdxStream();
stream.append(token);
\`\`\`

See [the guide][guide] for details.[^tail]

[guide]: https://example.com/guide

[^tail]: The tail is everything after the last settled block.
`,
  `Here is a quick comparison:

| Approach | Work per token |
| :- | -: |
| Re-parse | grows with the message |
| Incremental | stays flat |

> A long answer stays fast, because *finished* paragraphs never render again.
`,
  `Inline math such as $e^{i\\pi} + 1 = 0$ renders once its closing dollar arrives.

<Note title="Pending JSX">
Components render their **pending** variant until the closing tag arrives.
</Note>
`,
] as const;

/** Splits text into word-sized chunks, like model tokens. */
export function tokenChunks(text: string): readonly string[] {
  return text.match(/\s*\S+\s*/gu) ?? [];
}
