import { analyzeDocument, type CompilerState } from "./compile-analysis.ts";
import { emitContent, documentUsesAwait } from "./compile.ts";
import { CompileError, MdxError, EvaluationError } from "./errors.ts";
import { javascriptPropertyName } from "./javascript-ast.ts";
import { parseJavaScriptProgram } from "./javascript.ts";
import { DocumentNode } from "./model.ts";
import { CodeWriter, type SourceMap } from "./source-map.ts";

const defaultMaximumGeneratedCodeBytes = 10 * 1024 * 1024;
const defaultMaximumSourceMapBytes = 5 * 1024 * 1024;

export interface CompileOptions {
  /** Emit `jsxDEV` calls with authored source locations. */
  readonly development?: boolean;
  /** Package providing `jsx-runtime`. */
  readonly jsxImportSource?: string;
  /** Maximum UTF-8 size of generated JavaScript. */
  readonly maximumGeneratedCodeBytes?: number;
  /** Maximum UTF-8 size of the serialized source map. */
  readonly maximumSourceMapBytes?: number;
  /** Optional generated filename written into the source map. */
  readonly outputName?: string;
  /** Optional package providing a `useMDXComponents` export. */
  readonly providerImportSource?: string;
  /** Original MDX filename written into the source map. */
  readonly sourceName?: string;
}

export interface CompileArtifact {
  readonly code: string;
  readonly document: DocumentNode;
  readonly map: SourceMap;
}

export interface TrustedEvaluationEnvironment<Module> {
  readonly evaluateModule: (artifact: CompileArtifact) => Module | PromiseLike<Module>;
}

/** Compiles owned MDX nodes to a non-evaluated JSX-runtime ESM module. */
export function compile(
  document: DocumentNode,
  options: Readonly<CompileOptions> = {},
): CompileArtifact {
  try {
    const state = analyzeDocument(document, options);
    const usesAwait = documentUsesAwait(document);

    const writer = new CodeWriter(document.origin?.file);
    emitModulePreamble(writer, state, options);
    emitContentFunction(writer, document, state, options, usesAwait);
    emitPublicComponent(writer, state, options, usesAwait);
    if (state.missingReferences.size > 0) {
      emitMissingReferenceHelper(writer);
    }

    const code = writer.toString();
    enforceGeneratedCodeLimit(code, options.maximumGeneratedCodeBytes);
    try {
      parseJavaScriptProgram(code);
    } catch (cause) {
      CompileError.generatedProgramInvalid(cause);
    }

    const map = writer.sourceMap(options.sourceName ?? "source.mdx", options.outputName);
    enforceSourceMapLimit(map, options.maximumSourceMapBytes);
    return Object.freeze({ document, code, map });
  } catch (cause) {
    if (cause instanceof MdxError) {
      throw cause;
    }
    CompileError.generationFailed(cause);
  }
}

/** Evaluates a trusted artifact through a caller-owned module environment. */
export async function evaluateTrusted<Module>(
  artifact: CompileArtifact,
  environment: TrustedEvaluationEnvironment<Module>,
): Promise<Module> {
  try {
    return await environment.evaluateModule(artifact);
  } catch (cause) {
    if (cause instanceof MdxError) {
      throw cause;
    }
    EvaluationError.environmentFailed(cause);
  }
}

function emitModulePreamble(
  writer: CodeWriter,
  state: CompilerState,
  options: Readonly<CompileOptions>,
): void {
  for (const entry of state.esm) {
    writer.write(`${entry.code.trimEnd()}\n`, entry.span);
  }
  const importSource = options.jsxImportSource ?? "react";
  writer.write(
    state.development
      ? `import {Fragment as _Fragment, jsxDEV as _jsxDEV} from ${JSON.stringify(`${importSource}/jsx-dev-runtime`)};\n`
      : `import {Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs} from ${JSON.stringify(`${importSource}/jsx-runtime`)};\n`,
  );
  if (options.providerImportSource !== undefined) {
    writer.write(
      `import {useMDXComponents as _provideComponents} from ${JSON.stringify(options.providerImportSource)};\n`,
    );
  }
}

function emitContentFunction(
  writer: CodeWriter,
  document: DocumentNode,
  state: CompilerState,
  options: Readonly<CompileOptions>,
  usesAwait: boolean,
): void {
  writer.write(`${usesAwait ? "async " : ""}function _createContent(props) {\n`);
  writer.write("  const _components = {");
  const tags = [...state.intrinsicTags].sort();
  tags.forEach((tag, index) => {
    if (index > 0) {
      writer.write(", ");
    }
    writer.write(`${javascriptPropertyName(tag)}:${JSON.stringify(tag)}`);
  });
  if (options.providerImportSource !== undefined) {
    writer.write(`${tags.length === 0 ? "" : ", "}..._provideComponents()`);
  }
  writer.write(
    `${tags.length === 0 && options.providerImportSource === undefined ? "" : ", "}...props.components};\n`,
  );

  const components = [...state.referencedComponents].sort();
  if (components.length > 0) {
    writer.write(`  const {${components.join(", ")}} = _components;\n`);
  }
  for (const [reference, component] of state.missingReferences) {
    writer.write(
      `  if (!${reference}) _missingReference(${JSON.stringify(reference)}, ${component});\n`,
    );
  }
  writer.write("  return ");
  emitContent(writer, document, state);
  writer.write(";\n}\n");
}

function emitPublicComponent(
  writer: CodeWriter,
  state: CompilerState,
  options: Readonly<CompileOptions>,
  usesAwait: boolean,
): void {
  writer.write(`export default ${usesAwait ? "async " : ""}function Content(props = {}) {\n`);
  const content = `${usesAwait ? "await " : ""}_createContent(props)`;
  if (state.hasInternalLayout) {
    writer.write(`  return ${runtimeCall(state, "Layout", `{...props, children: ${content}}`)};\n`);
  } else {
    writer.write("  const {wrapper: Layout} = {");
    if (options.providerImportSource !== undefined) {
      writer.write("..._provideComponents(), ");
    }
    writer.write("...props.components};\n");
    writer.write(
      `  return Layout ? ${runtimeCall(state, "Layout", `{...props, children: ${content}}`)} : ${content};\n`,
    );
  }
  writer.write("}\n");
}

function emitMissingReferenceHelper(writer: CodeWriter): void {
  writer.write(
    "class ReferenceError extends Error {\n" +
      "  constructor(id, component) {\n" +
      '    super(`Expected ${component ? "component" : "object"} ${id} to be defined: you likely forgot to import, pass, or provide it.`);\n' +
      '    this.name = "ReferenceError";\n' +
      "  }\n" +
      "}\n" +
      "function _missingReference(id, component) {\n" +
      "  throw new ReferenceError(id, component);\n" +
      "}\n",
  );
}

// Having default max size could cause trouble.
function enforceGeneratedCodeLimit(code: string, configuredMaximum: number | undefined): void {
  const maximum = configuredMaximum ?? defaultMaximumGeneratedCodeBytes;
  const actual = new TextEncoder().encode(code).byteLength;
  if (actual > maximum) {
    CompileError.generatedCodeLimitExceeded(actual, maximum);
  }
}

function enforceSourceMapLimit(map: SourceMap, configuredMaximum: number | undefined): void {
  const maximum = configuredMaximum ?? defaultMaximumSourceMapBytes;
  const actual = new TextEncoder().encode(JSON.stringify(map)).byteLength;
  if (actual > maximum) {
    CompileError.sourceMapLimitExceeded(actual, maximum);
  }
}

function runtimeCall(state: CompilerState, tag: string, properties: string): string {
  return state.development
    ? `_jsxDEV(${tag}, ${properties}, undefined, false, undefined, undefined)`
    : `_jsx(${tag}, ${properties})`;
}
