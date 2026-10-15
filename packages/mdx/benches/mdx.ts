import { compile as compileMdx, createProcessor } from "@mdx-js/mdx";
import { streamingMarkdownExtension } from "@tanstack/markdown/extensions/streaming";
import { renderHtml } from "@tanstack/markdown/html";
import { parseMarkdown } from "@tanstack/markdown/parser";
import { writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { parseArgs } from "node:util";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkHtml from "remark-html";
import { SourceMapGenerator } from "source-map";
import { Bench } from "tinybench";

import { compile, formatHtml, lowerHtml, MdxStream, parse, previewDocument } from "../dist/mod.mjs";
import manifest from "../package.json" with { type: "json" };
import { markdownFixtures, mdxFixtures, streamingFixtures, type Fixture } from "./fixtures.ts";
import { outputDigest, semanticHtml } from "./html-output.ts";

const suites = ["parse", "html", "compile", "stream"];

const { values } = parseArgs({
  options: {
    suite: { type: "string", default: "all" },
    filter: { type: "string", default: "" },
    time: { type: "string", default: "500" },
    rounds: { type: "string", default: "2" },
    "chunk-size": { type: "string", default: "32,256" },
    json: { type: "string" },
    verify: { type: "boolean", default: false },
  },
});

const time = Number(values.time);

const rounds = Number(values.rounds);

const chunkSizes = values["chunk-size"].split(",").map(Number);

if (values.suite !== "all" && !suites.includes(values.suite)) {
  throw new Error(`Unknown suite: ${values.suite}. Choose ${suites.join(", ")} or all.`);
}

if (
  !Number.isFinite(time) ||
  time <= 0 ||
  !Number.isSafeInteger(rounds) ||
  rounds < 1 ||
  chunkSizes.some((size) => !Number.isSafeInteger(size) || size < 1)
) {
  throw new Error(
    "--time, --rounds, and every --chunk-size must be positive; rounds and chunks must be integers.",
  );
}

const remarkParser = remark().use(remarkGfm).freeze();

const remarkRenderer = remark().use(remarkGfm).use(remarkHtml).freeze();

const mdxParser = createProcessor({ remarkPlugins: [remarkGfm] });

const markdownOptions = { frontmatter: false, headingIds: false };

const streamingOptions = { ...markdownOptions, extensions: [streamingMarkdownExtension()] };

const environment = {
  node: process.version,
  cpu: cpus()[0]?.model,
  platform: process.platform,
  arch: process.arch,
  versions: {
    "@temelj/mdx": manifest.version,
    "@mdx-js/mdx": manifest.devDependencies["@mdx-js/mdx"],
    "@tanstack/markdown": manifest.devDependencies["@tanstack/markdown"],
    remark: manifest.devDependencies.remark,
    tinybench: manifest.devDependencies.tinybench,
  },
  implementation: "built ESM for every library",
  orderBalanced: rounds % 2 === 0,
  time,
  rounds,
  chunkSizes,
};

interface OutputAudit {
  readonly suite: string;
  readonly fixture: string;
  readonly library: string;
  readonly outputBytes: number;
  readonly digest: string;
  readonly finalMatch: boolean;
  readonly updates?: number;
  matchingUpdates?: number;
  readonly chunkSize?: number;
}

const results = [];

const audits: OutputAudit[] = [];

let sink = 0;

let matched = 0;

console.log(environment);

for (const suite of suites) {
  if (values.suite !== "all" && values.suite !== suite) {
    continue;
  }

  const fixtures =
    suite === "stream"
      ? streamingFixtures
      : suite === "compile"
        ? [...markdownFixtures, ...mdxFixtures]
        : markdownFixtures;

  for (const fixture of fixtures) {
    for (const chunkSize of suite === "stream" ? chunkSizes : [0]) {
      const name = `${suite}/${fixture.name}${chunkSize === 0 ? "" : `/chunk-${chunkSize}`}`;
      const tasks: { library: string; run: () => void | Promise<void> }[] = [];
      const { source } = fixture;

      const chunks =
        suite === "stream"
          ? Array.from({ length: Math.ceil(source.length / chunkSize) }, (_, index) =>
              source.slice(index * chunkSize, (index + 1) * chunkSize),
            )
          : [];

      const add = (library: string, run: () => void | Promise<void>): void => {
        if (`${name}/${library}`.includes(values.filter)) {
          tasks.push({ library, run });
        }
      };

      switch (suite) {
        case "parse": {
          add("@temelj/mdx", () => {
            sink += parse(source).document.children.length;
          });
          add("@mdx-js/mdx", () => {
            sink += mdxParser.parse(source).children.length;
          });
          add("remark", () => {
            sink += remarkParser.parse(source).children.length;
          });
          add("@tanstack/markdown", () => {
            sink += parseMarkdown(source, markdownOptions).children.length;
          });
          add("@tanstack/markdown (defaults)", () => {
            sink += parseMarkdown(source).children.length;
          });
          break;
        }

        case "html": {
          add("@temelj/mdx", () => {
            consumeHtml(temeljHtml(source));
          });
          add("remark", () => {
            consumeHtml(String(remarkRenderer.processSync(source)));
          });
          add("@tanstack/markdown", () => {
            consumeHtml(renderHtml(source, markdownOptions));
          });
          add("@tanstack/markdown (defaults)", () => {
            consumeHtml(renderHtml(source));
          });
          break;
        }

        case "compile": {
          add("@temelj/mdx", async () => {
            consumeHtml((await compile(parse(source))).artifact.code);
          });
          add("@mdx-js/mdx", async () => {
            consumeHtml(
              String(
                await compileMdx(source, {
                  outputFormat: "function-body",
                  remarkPlugins: [remarkGfm],
                  SourceMapGenerator,
                }),
              ),
            );
          });
          add("@mdx-js/mdx (no map)", async () => {
            consumeHtml(
              String(
                await compileMdx(source, {
                  outputFormat: "function-body",
                  remarkPlugins: [remarkGfm],
                }),
              ),
            );
          });

          break;
        }

        case "stream": {
          add("@temelj/mdx", () => {
            const stream = new MdxStream();

            for (const chunk of chunks) {
              consumeHtml(formatHtml(previewDocument(stream.append(chunk))));
            }

            consumeHtml(formatHtml(lowerHtml(stream.complete().document)));
          });
          add("remark", () => {
            let accumulated = "";

            for (const chunk of chunks) {
              accumulated += chunk;
              consumeHtml(String(remarkRenderer.processSync(accumulated)));
            }

            consumeHtml(String(remarkRenderer.processSync(accumulated)));
          });
          add("@tanstack/markdown", () => {
            tanstackStream(chunks, true);
          });
          add("@tanstack/markdown (core)", () => {
            tanstackStream(chunks, false);
          });
          break;
        }
      }

      if (tasks.length === 0) {
        continue;
      }

      matched++;

      if (suite === "compile") {
        const own = await compile(parse(source));

        const mdx = await compileMdx(source, {
          outputFormat: "function-body",
          remarkPlugins: [remarkGfm],
          SourceMapGenerator,
        });

        if (own.artifact.map.version !== 3 || mdx.map?.version !== 3) {
          throw new Error(`Both compilers must emit source maps: ${fixture.name}`);
        }
      } else {
        // Audit every renderer, even when a filter selects one for timing.
        const checked = auditOutput(suite, fixture, chunks, chunkSize);
        audits.push(...checked);
        console.log(
          `${name}: final HTML differs from remark for ${
            checked
              .filter((entry) => !entry.finalMatch)
              .map((entry) => entry.library)
              .join(", ") || "none"
          }`,
        );
      }

      if (values.verify) {
        continue;
      }

      for (let round = 0; round < rounds; round++) {
        const bench = new Bench({
          name,
          time,
          warmupTime: 200,
          warmupIterations: 2,
          iterations: 8,
          throws: true,
        });

        const ordered = round % 2 === 0 ? tasks : tasks.toReversed();

        for (const task of ordered) {
          bench.add(task.library, task.run);
        }

        await bench.run();
        console.log(`${name}, round ${round + 1}: ${Buffer.byteLength(source)} bytes`);
        console.table(bench.table());

        for (const task of bench.tasks) {
          const result = task.result;

          if (result.state !== "completed") {
            throw new Error(`${name}/${task.name} did not complete: ${result.state}`);
          }

          const audit = audits.find(
            (entry) =>
              entry.suite === suite &&
              entry.fixture === fixture.name &&
              entry.library === task.name &&
              (suite !== "stream" || entry.chunkSize === chunkSize),
          );

          results.push({
            suite,
            fixture: fixture.name,
            library: task.name,
            round: round + 1,
            bytes: Buffer.byteLength(source),
            chunkSize: chunkSize || undefined,
            updates: suite === "stream" ? chunks.length : 1,
            finalMatch: audit?.finalMatch,
            matchingUpdates: audit?.matchingUpdates,
            fullyMatched:
              audit === undefined
                ? undefined
                : audit.finalMatch &&
                  (suite !== "stream" || audit.matchingUpdates === audit.updates),
            meanMs: result.latency.mean,
            p50Ms: result.latency.p50,
            p99Ms: result.latency.p99,
            rme: result.latency.rme,
            samples: result.latency.samplesCount,
          });
        }
      }
    }
  }
}

if (matched === 0) {
  throw new Error(`No benchmarks matched ${values.filter}.`);
}

console.log(
  "Output audit relative to remark: finalMatch checks the complete document; matchingUpdates checks previews.",
);

console.table(audits.map(({ digest, ...entry }) => ({ ...entry, sha256: digest.slice(0, 12) })));

console.log(`Output sink: ${sink}`);

if (values.json !== undefined) {
  await writeFile(
    values.json,
    JSON.stringify({ environment, results, audits, sink }, null, 2) + "\n",
  );
}

function consumeHtml(output: string): void {
  // Reading the last character forces rope strings to flatten for every renderer.
  sink = (sink + output.length + (output.charCodeAt(output.length - 1) || 0)) >>> 0;
}

function temeljHtml(source: string): string {
  return formatHtml(lowerHtml(parse(source).document));
}

function tanstackStream(chunks: readonly string[], streaming: boolean): void {
  let accumulated = "";
  const options = streaming ? streamingOptions : markdownOptions;

  for (const chunk of chunks) {
    accumulated += chunk;
    consumeHtml(renderHtml(accumulated, options));
  }

  consumeHtml(renderHtml(accumulated, options));
}

function auditOutput(
  suite: string,
  fixture: Fixture,
  chunks: readonly string[],
  chunkSize: number,
): OutputAudit[] {
  const reference = semanticHtml(String(remarkRenderer.processSync(fixture.source)));

  const renderers = [
    ["@temelj/mdx", temeljHtml(fixture.source)],
    ["remark", String(remarkRenderer.processSync(fixture.source))],
    ["@tanstack/markdown", renderHtml(fixture.source, markdownOptions)],
    ["@tanstack/markdown (defaults)", renderHtml(fixture.source)],
  ];

  if (suite === "stream") {
    renderers.pop();
    renderers[2] = ["@tanstack/markdown", renderHtml(fixture.source, streamingOptions)];
    renderers.push(["@tanstack/markdown (core)", renderHtml(fixture.source, markdownOptions)]);
  }

  const output: OutputAudit[] = renderers.map(([library, html]) => ({
    suite,
    fixture: fixture.name,
    library,
    outputBytes: Buffer.byteLength(html),
    digest: outputDigest(html),
    finalMatch: semanticHtml(html) === reference,
    chunkSize: chunkSize || undefined,
    updates: suite === "stream" ? chunks.length : undefined,
    matchingUpdates: suite === "stream" ? 0 : undefined,
  }));

  if (suite === "stream") {
    const stream = new MdxStream();
    let accumulated = "";

    for (const chunk of chunks) {
      accumulated += chunk;
      const referenceHtml = String(remarkRenderer.processSync(accumulated));
      const expected = semanticHtml(referenceHtml);

      const actual = [
        formatHtml(previewDocument(stream.append(chunk))),
        referenceHtml,
        renderHtml(accumulated, streamingOptions),
        renderHtml(accumulated, markdownOptions),
      ];

      for (let index = 0; index < actual.length; index++) {
        if (semanticHtml(actual[index]) === expected) {
          output[index].matchingUpdates = (output[index].matchingUpdates ?? 0) + 1;
        }
      }
    }

    if (formatHtml(lowerHtml(stream.complete().document)) !== renderers[0][1]) {
      throw new Error(`Stream completion differs from batch parsing: ${fixture.name}`);
    }
  }

  return output;
}
