/// <reference lib="webworker" />

import ts from "typescript";

import type { TypeCheckRequest, TypeCheckResponse, TypeDiagnostic } from "./typecheck";

// Declarations are bundled as text: the TypeScript libs the program may use, plus the published
// typings of @temelj/audio and the one package its typings import.
const LIB_FILES = import.meta.glob<string>(
  [
    "/node_modules/typescript/lib/lib.es5.d.ts",
    "/node_modules/typescript/lib/lib.es20{15,16,17,18,19,20,21,22}*.d.ts",
    "!/node_modules/typescript/lib/lib.*.full.d.ts",
    "/node_modules/typescript/lib/lib.decorators*.d.ts",
    "/node_modules/typescript/lib/lib.dom*.d.ts",
  ],
  { eager: true, import: "default", query: "?raw" },
);

const AUDIO_TYPES = import.meta.glob<string>("/node_modules/@temelj/audio/dist/**/*.d.mts", {
  eager: true,
  import: "default",
  query: "?raw",
});

const EVENT_TYPES = import.meta.glob<string>(
  "/node_modules/@temelj/audio/node_modules/@temelj/event/dist/**/*.d.mts",
  { eager: true, import: "default", query: "?raw" },
);

const PROGRAM_FILE = "/playground.ts";

// Checks the default export against what the playground calls, without the user writing it.
const CONTRACT_FILE = "/contract.ts";

const CONTRACT = `import type { Blueprint, PlayContext } from "@temelj/audio";
import program from "./playground";

type ProgramResult = Blueprint | { readonly output: Blueprint; readonly play?: (context: PlayContext) => void };

export const contract: (input: Blueprint) => ProgramResult = program;
`;

const files = new Map<string, string>();

for (const [path, text] of Object.entries(LIB_FILES)) {
  files.set(`/${path.split("/").at(-1)}`, text);
}

for (const [path, text] of Object.entries(AUDIO_TYPES)) {
  files.set(path.replace("/node_modules/@temelj/audio/", "/types/audio/"), text);
}

for (const [path, text] of Object.entries(EVENT_TYPES)) {
  files.set(
    path.replace("/node_modules/@temelj/audio/node_modules/@temelj/event/", "/types/event/"),
    text,
  );
}

files.set(CONTRACT_FILE, CONTRACT);

const options: ts.CompilerOptions = {
  allowImportingTsExtensions: true,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  paths: {
    "@temelj/audio": ["/types/audio/dist/mod.d.mts"],
    "@temelj/event": ["/types/event/dist/mod.d.mts"],
  },
  skipLibCheck: true,
  strict: true,
  target: ts.ScriptTarget.ES2022,
  types: [],
};

let programVersion = 0;

const host: ts.LanguageServiceHost = {
  directoryExists: (path) => {
    const prefix = path.endsWith("/") ? path : `${path}/`;

    return [...files.keys()].some((file) => file.startsWith(prefix));
  },
  fileExists: (path) => files.has(path),
  getCompilationSettings: () => options,
  getCurrentDirectory: () => "/",
  getDefaultLibFileName: () => "/lib.es2022.d.ts",
  getScriptFileNames: () => [PROGRAM_FILE, CONTRACT_FILE],
  getScriptSnapshot: (path) => {
    const text = files.get(path);

    return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
  },
  getScriptVersion: (path) => (path === PROGRAM_FILE ? String(programVersion) : "0"),
  readFile: (path) => files.get(path),
};

const service = ts.createLanguageService(host, ts.createDocumentRegistry());

function check(code: string): TypeDiagnostic[] {
  files.set(PROGRAM_FILE, code);
  programVersion += 1;

  const program = [
    ...service.getSyntacticDiagnostics(PROGRAM_FILE),
    ...service.getSemanticDiagnostics(PROGRAM_FILE),
  ].map((diagnostic) => toDiagnostic(diagnostic));

  // Contract errors only matter once the program itself is sound.
  if (program.length > 0) {
    return program;
  }

  return service.getSemanticDiagnostics(CONTRACT_FILE).map((diagnostic) => ({
    ...toDiagnostic(diagnostic),
    line: undefined,
    message: `The default export does not match the playground contract: ${flatten(diagnostic)}`,
  }));
}

function toDiagnostic(diagnostic: ts.Diagnostic): TypeDiagnostic {
  const position =
    diagnostic.file === undefined || diagnostic.start === undefined
      ? undefined
      : diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);

  return {
    column: position === undefined ? undefined : position.character + 1,
    line: position === undefined ? undefined : position.line + 1,
    message: flatten(diagnostic),
  };
}

function flatten(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}

self.onmessage = (event: MessageEvent<TypeCheckRequest>) => {
  const { code, id } = event.data;
  let response: TypeCheckResponse;

  try {
    response = { diagnostics: check(code), id };
  } catch (error) {
    response = { error: error instanceof Error ? error.message : String(error), id };
  }

  self.postMessage(response);
};
