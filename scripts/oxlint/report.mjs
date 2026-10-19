import { readFileSync } from "node:fs";

const [filename, prefix = "", rule = ""] = process.argv.slice(2);

if (filename === undefined) {
  throw new Error("Usage: node scripts/oxlint/report.mjs <lint.json> [path-prefix] [rule]");
}

const text = readFileSync(filename, "utf8");

const report = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));

const diagnostics = report.diagnostics.filter(
  (diagnostic) => diagnostic.filename.startsWith(prefix) && diagnostic.code.includes(rule),
);

const counts = new Map();

for (const diagnostic of diagnostics) {
  counts.set(diagnostic.code, (counts.get(diagnostic.code) ?? 0) + 1);
}

for (const [code, count] of [...counts].sort((left, right) => right[1] - left[1])) {
  console.log(`${count}\t${code}`);
}

console.log(
  `${diagnostics.length} diagnostics in ${new Set(diagnostics.map((item) => item.filename)).size} files`,
);

if (prefix || rule) {
  for (const diagnostic of diagnostics) {
    const location = diagnostic.labels[0]?.span;

    console.log(
      `${diagnostic.filename}:${location?.line ?? 1}:${location?.column ?? 1} ${diagnostic.code}: ${diagnostic.message}`,
    );
  }
} else {
  const packages = new Map();

  for (const diagnostic of diagnostics) {
    const directory = diagnostic.filename.split("/").slice(0, 2).join("/");

    packages.set(directory, (packages.get(directory) ?? 0) + 1);
  }

  for (const [directory, count] of [...packages].sort((left, right) => right[1] - left[1])) {
    console.log(`${count}\t${directory}`);
  }
}
