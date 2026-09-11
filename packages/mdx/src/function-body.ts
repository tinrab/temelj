import { isString } from "@temelj/value";

import {
  childNode,
  collectPatternNames,
  nodeArray,
  nodeValue,
  type JavaScriptNode,
} from "./javascript-ast.ts";
import { parseJavaScriptProgram } from "./javascript.ts";

export interface FunctionBodyProgram {
  readonly code: string;
  readonly imports: readonly string[];
}

interface ExportBinding {
  readonly exported: string;
  readonly local: string;
}

/** Rewrites an emitted ESM program into an async function body with explicit imports. */
export function toFunctionBody(source: string, runtimeImportSource: string): FunctionBodyProgram {
  const program = parseJavaScriptProgram(source);
  const chunks: string[] = [];
  const imports: string[] = [];
  const exports: ExportBinding[] = [];
  const starExports: string[] = [];
  let cursor = 0;
  let moduleIndex = 0;
  let defaultBinding: string | undefined;

  for (const statement of nodeArray(program, "body")) {
    chunks.push(source.slice(cursor, statement.start));
    const replacementIndex = chunks.length;

    if (statement.type === "ImportDeclaration") {
      const specifier = moduleSpecifier(statement);
      const runtime = isGeneratedRuntimeImport(statement, runtimeImportSource);

      if (runtime) {
        chunks.push(runtimeDeclaration(statement));
      } else {
        const moduleName = `__mdxModule${moduleIndex++}`;
        rememberImport(imports, specifier);
        chunks.push(
          `const ${moduleName} = await __resolveMdxImport(${JSON.stringify(specifier)});`,
        );
        chunks.push(importDeclarations(statement, moduleName));
      }
    } else if (statement.type === "ExportDefaultDeclaration") {
      const declaration = requiredChild(statement, "declaration");
      const name = declarationName(declaration);

      if (name === undefined) {
        defaultBinding = "__mdxDefault";
        chunks.push(
          `const ${defaultBinding} = (${source.slice(declaration.start, declaration.end)});`,
        );
      } else {
        defaultBinding = name;
        chunks.push(source.slice(declaration.start, declaration.end));
      }
    } else if (statement.type === "ExportNamedDeclaration") {
      const declaration = childNode(nodeValue(statement, "declaration"));

      if (declaration !== undefined) {
        chunks.push(source.slice(declaration.start, declaration.end));

        for (const name of declarationNames(declaration)) {
          exports.push({ exported: name, local: name });
        }
      } else {
        const from = childNode(nodeValue(statement, "source"));
        const moduleName = from === undefined ? undefined : `__mdxModule${moduleIndex++}`;

        if (from !== undefined && moduleName !== undefined) {
          const specifier = literalString(from);
          rememberImport(imports, specifier);
          chunks.push(
            `const ${moduleName} = await __resolveMdxImport(${JSON.stringify(specifier)});`,
          );
        }

        for (const specifier of nodeArray(statement, "specifiers")) {
          const local = identifierValue(requiredChild(specifier, "local"));
          const exported = identifierValue(requiredChild(specifier, "exported"));
          exports.push({
            exported,
            local: moduleName === undefined ? local : `${moduleName}[${JSON.stringify(local)}]`,
          });
        }
      }
    } else if (statement.type === "ExportAllDeclaration") {
      const sourceNode = requiredChild(statement, "source");
      const specifier = literalString(sourceNode);
      const moduleName = `__mdxModule${moduleIndex++}`;
      rememberImport(imports, specifier);
      chunks.push(`const ${moduleName} = await __resolveMdxImport(${JSON.stringify(specifier)});`);
      const exported = childNode(nodeValue(statement, "exported"));

      if (exported === undefined) {
        const starName = `__mdxStar${starExports.length}`;
        chunks.push(
          `const {default: __mdxIgnored${starExports.length}, ...${starName}} = ${moduleName};`,
        );
        starExports.push(starName);
      } else {
        exports.push({ exported: identifierValue(exported), local: moduleName });
      }
    } else {
      chunks.push(source.slice(statement.start, statement.end));
    }

    const replacement = chunks.splice(replacementIndex).join("");
    chunks.push(preserveLineCount(replacement, source.slice(statement.start, statement.end)));
    cursor = statement.end;
  }

  chunks.push(source.slice(cursor));
  chunks.push("\nreturn {");

  for (const star of starExports) {
    chunks.push(`...${star},`);
  }

  for (const binding of exports) {
    chunks.push(`${JSON.stringify(binding.exported)}:${binding.local},`);
  }

  if (defaultBinding !== undefined) {
    chunks.push(`default:${defaultBinding}`);
  }

  chunks.push("};\n");

  const code = chunks.join("");
  parseJavaScriptProgram(`async function __evaluateMdx(){\n${code}\n}`);

  return Object.freeze({ code, imports: Object.freeze(imports) });
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

function isGeneratedRuntimeImport(statement: JavaScriptNode, source: string): boolean {
  return (
    moduleSpecifier(statement) === source &&
    nodeArray(statement, "specifiers").some((specifier) => {
      const local = childNode(nodeValue(specifier, "local"));
      const name = local === undefined ? undefined : identifierValue(local);

      return name === "_jsx" || name === "_jsxs" || name === "_jsxDEV";
    })
  );
}

function runtimeDeclaration(statement: JavaScriptNode): string {
  return nodeArray(statement, "specifiers")
    .map((specifier) => {
      const imported = identifierValue(requiredChild(specifier, "imported"));
      const local = identifierValue(requiredChild(specifier, "local"));

      return `const ${local} = __mdxRuntime[${JSON.stringify(imported)}];`;
    })
    .join("");
}

function importDeclarations(statement: JavaScriptNode, moduleName: string): string {
  return nodeArray(statement, "specifiers")
    .map((specifier) => {
      const local = identifierValue(requiredChild(specifier, "local"));

      if (specifier.type === "ImportNamespaceSpecifier") {
        return `const ${local} = ${moduleName};`;
      }

      if (specifier.type === "ImportDefaultSpecifier") {
        return `const ${local} = ${moduleName}.default;`;
      }

      const imported = identifierValue(requiredChild(specifier, "imported"));

      return `const ${local} = ${moduleName}[${JSON.stringify(imported)}];`;
    })
    .join("");
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

function identifierValue(node: JavaScriptNode): string {
  const name = nodeValue(node, "name");
  const value = nodeValue(node, "value");

  if (isString(name)) {
    return name;
  }

  if (isString(value)) {
    return value;
  }

  throw new TypeError(`Expected ${node.type} to contain an identifier`);
}

function declarationName(node: JavaScriptNode): string | undefined {
  if (node.type !== "FunctionDeclaration" && node.type !== "ClassDeclaration") {
    return undefined;
  }

  const identifier = childNode(nodeValue(node, "id"));

  return identifier === undefined ? undefined : identifierValue(identifier);
}

function declarationNames(declaration: JavaScriptNode): string[] {
  const names = new Set<string>();

  if (declaration.type === "VariableDeclaration") {
    for (const item of nodeArray(declaration, "declarations")) {
      collectPatternNames(childNode(nodeValue(item, "id")), names);
    }
  } else {
    const identifier = childNode(nodeValue(declaration, "id"));
    collectPatternNames(identifier, names);
  }

  return [...names];
}

function rememberImport(imports: string[], specifier: string): void {
  if (!imports.includes(specifier)) {
    imports.push(specifier);
  }
}
