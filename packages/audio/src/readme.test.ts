import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const PACKAGE_ROOT = new URL("..", import.meta.url).pathname;

const README_PATH = join(PACKAGE_ROOT, "README.md");

const TSC_PATH = join(PACKAGE_ROOT, "node_modules/.bin/tsc");

const PACKAGE_IMPORT = '"@temelj/audio"';

const SNIPPET_PATTERN = /```(?:ts|typescript)\n([\s\S]*?)```/g;

const AMBIENT_DECLARATIONS = `
declare const audioBuffer: AudioBuffer;
declare const bassBus: AudioNode;
declare const context: AudioContext;
declare const drumBus: AudioNode;
declare const leftEffect: AudioNode;
declare const liveMeter: AnalyserNode;
declare const mediaStreams: Record<string, MediaStream>;
declare const meter: HTMLElement;
declare const rightEffect: AudioNode;
declare const source: OscillatorNode;
`;

const DIAGNOSTIC_PATTERN = /^(?<file>[^(]+)\((?<line>\d+),(?<column>\d+)\): (?<message>.*)$/;

type DocumentSnippet = {
  readonly code: string;
  readonly document: string;
  readonly line: number;
};

function extractSnippets(markdown: string, document: string): DocumentSnippet[] {
  return [...markdown.matchAll(SNIPPET_PATTERN)].map((match) => ({
    code: match[1] ?? "",
    document,
    line: markdown.slice(0, match.index).split("\n").length + 1,
  }));
}

function createTsconfig(files: readonly string[]): string {
  return JSON.stringify({
    compilerOptions: {
      allowImportingTsExtensions: true,
      lib: ["esnext", "dom", "dom.iterable"],
      module: "esnext",
      moduleResolution: "bundler",
      noEmit: true,
      paths: {
        "@temelj/audio": [join(PACKAGE_ROOT, "src/mod.ts")],
      },
      skipLibCheck: true,
      strict: true,
      target: "esnext",
      types: [],
    },
    files,
  });
}

function formatDiagnostic(
  line: string,
  snippetsByFile: ReadonlyMap<string, DocumentSnippet>,
): string {
  const match = DIAGNOSTIC_PATTERN.exec(line);

  const snippet =
    match?.groups === undefined
      ? undefined
      : snippetsByFile.get(resolve(PACKAGE_ROOT, match.groups["file"] ?? ""));

  if (match?.groups === undefined || snippet === undefined) {
    return line;
  }

  const documentLine = snippet.line + Number(match.groups["line"]) - 1;

  return `${snippet.document}:${documentLine}:${match.groups["column"]} ${match.groups["message"]}`;
}

async function runTypeScript(project: string): Promise<string[]> {
  try {
    await execFileAsync(TSC_PATH, ["-p", project], { cwd: PACKAGE_ROOT });

    return [];
  } catch (error: unknown) {
    const output =
      error instanceof Error && "stdout" in error ? String(error.stdout) : String(error);

    return output.split("\n").filter((line) => line.includes("error TS"));
  }
}

describe("README examples", () => {
  it("typechecks every TypeScript snippet against the source API", async () => {
    const snippets = extractSnippets(await readFile(README_PATH, "utf8"), "README.md");

    const tempDir = await mkdtemp(join(tmpdir(), "temelj-audio-docs-"));

    try {
      const snippetsByFile = new Map<string, DocumentSnippet>();

      const files = await Promise.all(
        snippets.map(async (snippet, index) => {
          const file = join(tempDir, `snippet-${index}.ts`);
          await writeFile(file, snippet.code);
          snippetsByFile.set(file, snippet);

          return file;
        }),
      );

      const ambient = join(tempDir, "ambient.d.ts");
      await writeFile(ambient, AMBIENT_DECLARATIONS);
      const project = join(tempDir, "tsconfig.json");
      await writeFile(project, createTsconfig([ambient, ...files]));

      const diagnostics = await runTypeScript(project);

      expect(diagnostics.map((line) => formatDiagnostic(line, snippetsByFile))).toEqual([]);
      expect(snippets.length).toBeGreaterThan(0);
      expect(snippets.filter((snippet) => !snippet.code.includes(PACKAGE_IMPORT))).toEqual([]);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  }, 60_000);
});
