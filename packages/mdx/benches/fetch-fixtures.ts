import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

/** All Markdown fixtures in TanStack's benchmark corpus at this revision. */
const revision = "d9b5ef7133ba514f7269cd8f29b5719cd34f5836";

const fixtures = [
  ["ai-response", "0f4d8b974efefa5dd91fab7f6f447aac931d9f2fc8a553da57947da88ba2175f"],
  ["code-heavy", "33f339e137b517fec51f352ff95030219352d30b45f5bfe687aa21f37bf1b88f"],
  ["malformed", "463189dd7d026115ac973e5380d3fe56999b139253a3d56ae1dfb88a063cc554"],
  ["prose-heavy", "8e781df4cb91d7e9c037900d277ddb7d09cb98a3dd6541cbcbdfac4c2bd404be"],
  ["small-doc", "2d0b543050b95b5321c1c1482bef367364adb96e728662b6734fa6625238cec3"],
  ["tables-lists", "dae07efc192e3e215a125c72ed7278d5f81ef3da36e4409afd7d755d17d1b81e"],
];

const directory = new URL("./fixtures/tanstack/", import.meta.url);

await mkdir(directory, { recursive: true });

for (const [name, expected] of fixtures) {
  const response = await fetch(
    `https://raw.githubusercontent.com/TanStack/markdown/${revision}/fixtures/benchmark/${name}.md`,
  );

  if (!response.ok) {
    throw new Error(`Could not fetch ${name}: HTTP ${response.status}`);
  }

  const source = await response.text();
  const actual = createHash("sha256").update(source).digest("hex");

  if (actual !== expected) {
    throw new Error(`Upstream fixture checksum changed: ${name}`);
  }

  await writeFile(new URL(`${name}.md`, directory), source);
  console.log(`${name}: ${Buffer.byteLength(source)} bytes, sha256 ${actual}`);
}
