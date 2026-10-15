import { performance } from "node:perf_hooks";

import { formatHtml, formatMdx, MdxStream, parse, previewDocument } from "../src/mod.ts";

/** Fixture generators by size, so scaling is visible as the input doubles. */
const fixtures: ReadonlyArray<readonly [string, (count: number) => string]> = [
  ["paragraphs", (count) => "Some **bold** text and a [link](/x) here.\n\n".repeat(count)],
  ["open-paragraph", (count) => "Some **bold** text and a [link](/x) here.\n".repeat(count)],
  ["open-fence", (count) => "```ts\n" + "const value = 1;\n".repeat(count)],
  ["list", (count) => "- item with *emphasis*\n".repeat(count)],
  ["containers", (count) => "> - One\n> - **Two**\n\n".repeat(count)],
  ["late-definitions", (count) => "Read [guide][g].\n\n".repeat(count) + "[g]: /guide\n"],
];

const sizes = [100, 400, 1600, 6400];

const chunkSize = 32;

const measurements = [];

for (const [name, create] of fixtures) {
  for (const count of sizes) {
    const source = create(count);
    const stream = new MdxStream();
    const latencies: number[] = [];

    for (let offset = 0; offset < source.length; offset += chunkSize) {
      const started = performance.now();
      stream.append(source.slice(offset, offset + chunkSize));
      latencies.push(performance.now() - started);
    }

    const snapshot = stream.append("");
    let started = performance.now();
    formatHtml(previewDocument(snapshot));
    const serializeMs = performance.now() - started;
    started = performance.now();
    const completed = stream.complete();
    const completeMs = performance.now() - started;
    const batch = parse(source);

    if (formatMdx(completed.document) !== formatMdx(batch.document)) {
      throw new Error(`Streaming completion diverged: ${name}`);
    }

    latencies.sort((left, right) => left - right);

    measurements.push({
      name,
      sourceLength: source.length,
      appends: latencies.length,
      totalMs: round(latencies.reduce((sum, value) => sum + value, 0)),
      p50Ms: round(percentile(latencies, 0.5)),
      p95Ms: round(percentile(latencies, 0.95)),
      maxMs: round(latencies.at(-1) ?? 0),
      serializeMs: round(serializeMs),
      completeMs: round(completeMs),
    });
  }
}

console.table(measurements);

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
