import { isString } from "@temelj/value";

import type { CompileOutputFormat } from "./compiler.ts";
import type { JavaScriptJsxContext } from "./javascript-jsx.ts";
import type { SourceRange } from "./model.ts";
import type { SourceFile } from "./source.ts";

import { CompileError } from "./errors.ts";
import {
  childNode,
  collectPatternNames,
  nodeArray,
  nodeValue,
  type JavaScriptNode,
} from "./javascript-ast.ts";
import { programTransformer } from "./javascript-jsx.ts";
import { parseJavaScriptProgram } from "./javascript.ts";

/** One authored ESM block, parsed once for bindings, JSX, and exports. */
export interface ParsedEsm {
  readonly code: string;
  readonly origin?: SourceRange;
  readonly program: JavaScriptNode;
}

export interface CompiledEsm {
  readonly code: string;
  readonly origin?: SourceRange;
}

/**
 * Authored ESM as emitted code. A function body resolves imports through
 * `__resolveMdxImport` and returns its exports, so it records both.
 */
export interface EmittedEsm {
  readonly blocks: readonly CompiledEsm[];
  /** A default export is the document layout. */
  readonly hasLayout: boolean;
  readonly imports: readonly string[];
  /** Entries of the object a function body returns, such as `"name":local` or `...spread`. */
  readonly exports: readonly string[];
}

export function parseEsm(code: string, origin: SourceRange | undefined): ParsedEsm {
  return { code, origin, program: parseJavaScriptProgram(code) };
}

/** Names that ESM declares or imports at the top level. */
export function collectEsmBindings(program: JavaScriptNode, names: Set<string>): void {
  for (const statement of nodeArray(program, "body")) {
    if (statement.type === "ImportDeclaration") {
      for (const specifier of nodeArray(statement, "specifiers")) {
        collectPatternNames(childNode(nodeValue(specifier, "local")), names);
      }
    } else if (statement.type === "ExportNamedDeclaration") {
      collectDeclarationNames(childNode(nodeValue(statement, "declaration")), names);
    } else {
      collectDeclarationNames(statement, names);
    }
  }
}

export function emitEsm(
  entries: readonly ParsedEsm[],
  format: CompileOutputFormat,
  context: JavaScriptJsxContext,
  file: SourceFile | undefined,
): EmittedEsm {
  const emitter = new EsmEmitter(format);

  const blocks = entries.map((entry): CompiledEsm => ({
    code: emitter.block(
      entry,
      programTransformer(
        entry.code,
        entry.program,
        context,
        entry.origin === undefined || file === undefined
          ? undefined
          : { file, offset: entry.origin.start },
      ),
    ),
    origin: entry.origin,
  }));

  return {
    blocks,
    hasLayout: emitter.hasLayout,
    imports: emitter.imports,
    exports: [...emitter.stars, ...emitter.exports],
  };
}

type Transform = (node: JavaScriptNode) => string;

/** Rewrites ESM statements for one output format. */
class EsmEmitter {
  readonly #format: CompileOutputFormat;
  readonly imports: string[] = [];
  readonly exports: string[] = [];
  /** Star re-exports spread first, so explicit exports win. */
  readonly stars: string[] = [];
  hasLayout = false;
  #modules = 0;

  public constructor(format: CompileOutputFormat) {
    this.#format = format;
  }

  public block(entry: ParsedEsm, transform: Transform): string {
    const { code } = entry;
    const chunks: string[] = [];
    let cursor = 0;

    for (const statement of nodeArray(entry.program, "body")) {
      chunks.push(code.slice(cursor, statement.start));
      // Rewritten statements keep their line count, so source map lines stay aligned.
      chunks.push(
        preserveLineCount(
          this.statement(statement, code, transform),
          code.slice(statement.start, statement.end),
        ),
      );
      cursor = statement.end;
    }

    chunks.push(code.slice(cursor));

    return chunks.join("");
  }

  private statement(statement: JavaScriptNode, code: string, transform: Transform): string {
    switch (statement.type) {
      case "ExportDefaultDeclaration":
        return this.layout(`(${transform(requiredChild(statement, "declaration"))})`);
      case "ExportNamedDeclaration":
        return this.namedExport(statement, code, transform);
      case "ImportDeclaration":
        return this.#format === "program"
          ? transform(statement)
          : this.resolve(moduleSpecifier(statement), (module) => importBindings(statement, module));
      case "ExportAllDeclaration":
        return this.#format === "program" ? transform(statement) : this.starExport(statement);
      default:
        return transform(statement);
    }
  }

  /** The default export becomes the layout that wraps the content. */
  private layout(value: string): string {
    if (this.hasLayout) {
      throw CompileError.multipleDefaultExports();
    }

    this.hasLayout = true;

    return `const Layout = ${value};`;
  }

  private namedExport(statement: JavaScriptNode, code: string, transform: Transform): string {
    const declaration = childNode(nodeValue(statement, "declaration"));

    if (declaration !== undefined) {
      if (this.#format === "program") {
        return transform(statement);
      }

      for (const name of declarationNames(declaration)) {
        this.exports.push(`${JSON.stringify(name)}:${name}`);
      }

      return transform(declaration);
    }

    const from = childNode(nodeValue(statement, "source"));
    const specifiers = nodeArray(statement, "specifiers");

    const layout = specifiers.find(
      (specifier) => identifierValue(childNode(nodeValue(specifier, "exported"))) === "default",
    );

    const remaining = specifiers.filter((specifier) => specifier !== layout);

    if (this.#format === "program") {
      return this.programNamedExport(statement, code, from, layout, remaining);
    }

    const bind = (module?: string): string => {
      const local = (specifier: JavaScriptNode): string => {
        const name = requiredIdentifier(specifier, "local");

        return module === undefined ? name : `${module}[${JSON.stringify(name)}]`;
      };

      for (const specifier of remaining) {
        this.exports.push(
          `${JSON.stringify(requiredIdentifier(specifier, "exported"))}:${local(specifier)}`,
        );
      }

      return layout === undefined ? "" : this.layout(local(layout));
    };

    return from === undefined ? bind() : this.resolve(literalString(from), bind);
  }

  private programNamedExport(
    statement: JavaScriptNode,
    code: string,
    from: JavaScriptNode | undefined,
    layout: JavaScriptNode | undefined,
    remaining: readonly JavaScriptNode[],
  ): string {
    if (layout === undefined) {
      return code.slice(statement.start, statement.end);
    }

    const localName = identifierValue(childNode(nodeValue(layout, "local")));

    if (localName === undefined) {
      throw CompileError.defaultExportBindingMissing();
    }

    if (this.hasLayout) {
      throw CompileError.multipleDefaultExports();
    }

    this.hasLayout = true;

    const layoutDeclaration =
      from === undefined
        ? `const Layout = ${localName};`
        : `import {${localName} as Layout} from ${code.slice(from.start, from.end)};`;

    if (remaining.length === 0) {
      return layoutDeclaration;
    }

    const suffix =
      from === undefined
        ? ";"
        : ` from ${code.slice(from.start, statement.end).replace(/;?$/u, ";")}`;

    return `${layoutDeclaration}\nexport {${remaining
      .map((specifier) => code.slice(specifier.start, specifier.end))
      .join(", ")}}${suffix}`;
  }

  private starExport(statement: JavaScriptNode): string {
    const exported = childNode(nodeValue(statement, "exported"));

    return this.resolve(moduleSpecifier(statement), (module) => {
      if (exported === undefined) {
        const star = `__mdxStar${this.#modules}`;
        this.stars.push(`...${star}`);

        return `const {default: __mdxIgnored${this.#modules}, ...${star}} = ${module};`;
      }

      this.exports.push(`${JSON.stringify(requiredIdentifierNode(exported))}:${module}`);

      return "";
    });
  }

  /** Resolves a module through the evaluator, then binds names from it. */
  private resolve(specifier: string, bind: (module: string) => string): string {
    const module = `__mdxModule${this.#modules++}`;

    if (!this.imports.includes(specifier)) {
      this.imports.push(specifier);
    }

    return `const ${module} = await __resolveMdxImport(${JSON.stringify(specifier)});${bind(module)}`;
  }
}

function importBindings(statement: JavaScriptNode, module: string): string {
  return nodeArray(statement, "specifiers")
    .map((specifier) => {
      const local = requiredIdentifier(specifier, "local");

      if (specifier.type === "ImportNamespaceSpecifier") {
        return `const ${local} = ${module};`;
      }

      if (specifier.type === "ImportDefaultSpecifier") {
        return `const ${local} = ${module}.default;`;
      }

      return `const ${local} = ${module}[${JSON.stringify(requiredIdentifier(specifier, "imported"))}];`;
    })
    .join("");
}

function preserveLineCount(replacement: string, original: string): string {
  const missingLines = countLineFeeds(original) - countLineFeeds(replacement);

  return missingLines <= 0 ? replacement : `${replacement}${"\n".repeat(missingLines)}`;
}

function countLineFeeds(value: string): number {
  let count = 0;

  for (const character of value) {
    if (character === "\n") {
      count++;
    }
  }

  return count;
}

function moduleSpecifier(statement: JavaScriptNode): string {
  return literalString(requiredChild(statement, "source"));
}

function literalString(node: JavaScriptNode): string {
  const value = nodeValue(node, "value");

  if (!isString(value)) {
    throw new TypeError("Expected a JavaScript string literal");
  }

  return value;
}

function requiredChild(node: JavaScriptNode, key: string): JavaScriptNode {
  const child = childNode(nodeValue(node, key));

  if (child === undefined) {
    throw new TypeError(`Expected ${node.type}.${key} to be a JavaScript node`);
  }

  return child;
}

function requiredIdentifier(node: JavaScriptNode, key: string): string {
  return requiredIdentifierNode(requiredChild(node, key));
}

function requiredIdentifierNode(node: JavaScriptNode): string {
  const value = identifierValue(node);

  if (value === undefined) {
    throw new TypeError(`Expected ${node.type} to contain an identifier`);
  }

  return value;
}

function identifierValue(node: JavaScriptNode | undefined): string | undefined {
  if (node === undefined) {
    return undefined;
  }

  const name = nodeValue(node, "name");
  const value = nodeValue(node, "value");

  return isString(name) ? name : isString(value) ? value : undefined;
}

function declarationNames(declaration: JavaScriptNode): string[] {
  const names = new Set<string>();
  collectDeclarationNames(declaration, names);

  return [...names];
}

function collectDeclarationNames(node: JavaScriptNode | undefined, names: Set<string>): void {
  if (node === undefined) {
    return;
  }

  if (node.type === "VariableDeclaration") {
    for (const declaration of nodeArray(node, "declarations")) {
      collectPatternNames(childNode(nodeValue(declaration, "id")), names);
    }
  } else if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
    collectPatternNames(childNode(nodeValue(node, "id")), names);
  }
}
