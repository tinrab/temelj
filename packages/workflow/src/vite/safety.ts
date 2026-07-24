import type {
  BindingIdentifier,
  CallExpression,
  Expression,
  FunctionBody,
  ImportDeclaration,
  MemberExpression,
  MetaProperty,
  NewExpression,
  Node,
  Program,
  StaticMemberExpression,
} from "oxc-parser";

import { builtinModules } from "node:module";

import { lineAndColumnOfPosition, visitWorkflowNode } from "./ast.ts";
import { WorkflowTransformError } from "./error.ts";

interface WorkflowSafetyTarget {
  readonly name: string;
  readonly body: FunctionBody;
}

const unsafeGlobalCallNames = new Set([
  "Date",
  "fetch",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "queueMicrotask",
]);

export function rejectObviousNondeterministicGlobals(
  entry: WorkflowSafetyTarget,
  sourceFile: { readonly text: string; readonly program: Program },
): void {
  const unsafeImports = collectUnsafeWorkflowImportBindings(sourceFile.program);
  visitWorkflowNode(entry.body, (node) => {
    if (isIdentifier(node) && unsafeImports.has(node.name)) {
      throwNondeterministicGlobalError(entry.name, unsafeImports.get(node.name)!, node, sourceFile);
    }
    if (isNewExpression(node) && isIdentifier(node.callee) && node.callee.name === "Date") {
      throwNondeterministicGlobalError(entry.name, "Date", node, sourceFile);
    }
    if (
      isCallExpression(node) &&
      isIdentifier(node.callee) &&
      unsafeGlobalCallNames.has(node.callee.name)
    ) {
      throwNondeterministicGlobalError(entry.name, node.callee.name, node, sourceFile);
    }
    if (isStaticMemberExpression(node)) {
      const unsafeGlobal = unsafeGlobalPropertyAccessName(node);
      if (unsafeGlobal !== undefined) {
        throwNondeterministicGlobalError(entry.name, unsafeGlobal, node, sourceFile);
      }
    }
  });
}

function collectUnsafeWorkflowImportBindings(sourceFile: Program): ReadonlyMap<string, string> {
  const bindings = new Map<string, string>();
  for (const statement of sourceFile.body) {
    if (statement.type !== "ImportDeclaration") {
      continue;
    }
    const specifier = statement.source.value;
    if (!isNodeBuiltinSpecifier(specifier)) {
      continue;
    }
    for (const importSpecifier of statement.specifiers) {
      if (importSpecifier.type === "ImportDefaultSpecifier") {
        bindings.set(importSpecifier.local.name, specifier);
        continue;
      }
      if (importSpecifier.type === "ImportNamespaceSpecifier") {
        bindings.set(importSpecifier.local.name, specifier);
        continue;
      }
      bindings.set(importSpecifier.local.name, `${specifier}.${importName(importSpecifier)}`);
    }
  }
  return bindings;
}

function importName(importSpecifier: ImportDeclaration["specifiers"][number]): string {
  if (importSpecifier.type !== "ImportSpecifier") {
    return importSpecifier.local.name;
  }
  return importSpecifier.imported.type === "Literal"
    ? String(importSpecifier.imported.value)
    : importSpecifier.imported.name;
}

function isNodeBuiltinSpecifier(specifier: string): boolean {
  const normalized = specifier.startsWith("node:") ? specifier.slice("node:".length) : specifier;
  const root = normalized.split("/", 1)[0]!;
  return builtinModules.includes(normalized) || builtinModules.includes(root);
}

function throwNondeterministicGlobalError(
  workflowName: string,
  globalName: string,
  node: Node,
  sourceFile: { readonly text: string },
): never {
  const position = lineAndColumnOfPosition(sourceFile.text, node.start);
  WorkflowTransformError.nondeterministicGlobal(
    workflowName,
    globalName,
    position.line,
    position.column,
  );
}

function unsafeGlobalPropertyAccessName(node: StaticMemberExpression): string | undefined {
  const path = propertyAccessPath(node);
  if (path === undefined) {
    return undefined;
  }
  const normalized = stripGlobalQualifier(path);
  if (
    normalized === "Date.now" ||
    normalized === "Math.random" ||
    normalized === "process.env" ||
    normalized === "crypto.randomUUID" ||
    normalized === "crypto.getRandomValues" ||
    normalized === "performance.now" ||
    normalized === "import.meta.env"
  ) {
    return normalized;
  }
  if (
    normalized === "setTimeout" ||
    normalized === "setInterval" ||
    normalized === "setImmediate" ||
    normalized === "queueMicrotask"
  ) {
    return normalized;
  }
  return undefined;
}

function propertyAccessPath(node: StaticMemberExpression): string | undefined {
  const left = propertyAccessExpressionPath(node.object);
  return left === undefined ? undefined : `${left}.${node.property.name}`;
}

function propertyAccessExpressionPath(expression: Expression): string | undefined {
  if (isIdentifier(expression)) {
    return expression.name;
  }
  if (isMetaProperty(expression)) {
    return `${expression.meta.name}.${expression.property.name}`;
  }
  if (isStaticMemberExpression(expression)) {
    return propertyAccessPath(expression);
  }
  return undefined;
}

function stripGlobalQualifier(path: string): string {
  if (path.startsWith("globalThis.")) {
    return path.slice("globalThis.".length);
  }
  if (path.startsWith("global.")) {
    return path.slice("global.".length);
  }
  if (path.startsWith("window.")) {
    return path.slice("window.".length);
  }
  return path;
}

function isIdentifier(node: Node): node is BindingIdentifier {
  return node.type === "Identifier";
}

function isCallExpression(node: Node): node is CallExpression {
  return node.type === "CallExpression";
}

function isNewExpression(node: Node): node is NewExpression {
  return node.type === "NewExpression";
}

function isMetaProperty(node: Node): node is MetaProperty {
  return node.type === "MetaProperty";
}

function isStaticMemberExpression(node: Node): node is StaticMemberExpression {
  return node.type === "MemberExpression" && (node as MemberExpression).computed === false;
}
