import { createBenchSuite } from "./lru.ts";

const sizes = { capacity: 50_000, sample: 50_000, overfill: 100_000 };
const scenarios = createBenchSuite(sizes);

const targets = process.argv.slice(2);
const selected = targets.length > 0 ? targets : Object.keys(scenarios);

for (const name of selected) {
  const run = scenarios[name];
  if (run === undefined) {
    console.error(`Unknown scenario: ${name}. Available: ${Object.keys(scenarios).join(", ")}`);
    process.exit(1);
  }
  await run();
}
