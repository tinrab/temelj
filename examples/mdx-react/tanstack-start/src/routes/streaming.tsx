import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { StreamingSourceContent } from "@temelj/mdx-react";
import { useCallback, useRef, useState } from "react";

import { KaTeXMath } from "~/components/KaTeXMath";
import { mdxRegistry } from "~/components/registry";
import { mdxSyntax } from "~/lib/mdx";

interface MdxStreamChunk {
  readonly content: string;
  readonly sequence: number;
}

const streamedMdxChunks = [
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
  "```c file=matmul.cu\n__global__ void matmul_naive(\n    const float* A, const float* B, float* C,\n    int M, int N, int K) {\n",
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
  "```c file=matmul-tiled.cu\ntemplate<int TILE>\n__global__ void matmul_tiled(\n    const float* A, const float* B, float* C,\n    int M, int N, int K) {\n",
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

const streamMdx = createServerFn().handler(async function* () {
  for (const [sequence, content] of streamedMdxChunks.entries()) {
    const delayMilliseconds = content.startsWith('description="') ? 2_000 : 500;
    await new Promise((resolve) => setTimeout(resolve, delayMilliseconds));
    yield { content, sequence } satisfies MdxStreamChunk;
  }
});

export const Route = createFileRoute("/streaming")({ component: StreamingExampleRoute });

type StreamState = "idle" | "streaming" | "stopped" | "complete" | "error";

function StreamingExampleRoute(): React.ReactNode {
  const [source, setSource] = useState("");
  const [state, setState] = useState<StreamState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>();
  const activeRun = useRef(0);

  const start = useCallback(async () => {
    const run = activeRun.current + 1;
    activeRun.current = run;
    setSource("");
    setErrorMessage(undefined);
    setState("streaming");

    try {
      for await (const chunk of await streamMdx()) {
        if (activeRun.current !== run) {
          return;
        }
        setSource((current) => current + chunk.content);
      }
      if (activeRun.current === run) {
        setState("complete");
      }
    } catch (error) {
      if (activeRun.current === run) {
        setErrorMessage(error instanceof Error ? error.message : "The stream failed");
        setState("error");
      }
    }
  }, []);

  const stop = useCallback(() => {
    activeRun.current += 1;
    setState("stopped");
  }, []);

  return (
    <>
      <h1 className="text-3xl font-bold">Streaming MDX</h1>

      <div className="flex items-center gap-3">
        <button
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium"
          onClick={state === "streaming" ? stop : () => void start()}
          type="button"
        >
          {streamButtonLabel(state)}
        </button>
        <output aria-live="polite" className="text-muted-foreground text-sm">
          {statusLabel(state)}
        </output>
      </div>

      <section
        aria-busy={state === "streaming"}
        aria-label="Streamed MDX output"
        className="min-h-80 rounded-lg border p-4"
      >
        {source.length === 0 ? (
          <p className="text-muted-foreground">Start the stream to render the incoming MDX.</p>
        ) : (
          <div className="typeset">
            <StreamingSourceContent
              components={mdxRegistry}
              math={KaTeXMath}
              syntax={mdxSyntax}
              source={source}
              status={state === "complete" ? "complete" : "streaming"}
            />
            {state === "streaming" ? (
              <span aria-hidden="true" className="inline-block animate-pulse">
                ▋
              </span>
            ) : null}
          </div>
        )}
      </section>

      {errorMessage === undefined ? null : (
        <p className="text-error" role="alert">
          {errorMessage}
        </p>
      )}
    </>
  );
}

function statusLabel(state: StreamState): string {
  switch (state) {
    case "idle":
      return "Ready";
    case "streaming":
      return "Receiving MDX...";
    case "stopped":
      return "Stream stopped";
    case "complete":
      return "Stream complete";
    case "error":
      return "Stream failed";
  }
}

function streamButtonLabel(state: StreamState): string {
  switch (state) {
    case "streaming":
      return "Stop stream";
    case "complete":
    case "error":
      return "Stream again";
    case "idle":
    case "stopped":
      return "Start stream";
  }
}
