import type {
  ArrowFunctionExpression,
  BindingIdentifier,
  BindingPattern,
  BindingRestElement,
  BlockStatement,
  CallExpression,
  CatchClause,
  Class,
  Expression,
  ForInStatement,
  ForOfStatement,
  ForStatement,
  Function as OxcFunction,
  FunctionBody,
  Node,
  ParamPattern,
  Program,
  Statement,
  SwitchStatement,
  VariableDeclarator,
} from "oxc-parser";

import path from "node:path";

import type {
  DirectiveKind,
  TransformManifestFunction,
  TransformMetadataEntry,
  TransformOptions,
  TransformResult,
} from "../types/vite.ts";

import {
  leadingTriviaStart,
  parseWorkflowSource,
  spanText,
  visitWorkflowNode,
  workflowNodeChildren,
  type WorkflowSourceFile,
} from "./ast.ts";
import { WorkflowTransformError } from "./error.ts";
import { makeGeneratedName } from "./generated-name.ts";
import { collectImportedStepBindings, collectReExportedManifestFunctions } from "./manifest.ts";
import { rejectObviousNondeterministicGlobals } from "./safety.ts";
import { SourceEditor } from "./source-edit.ts";
import { createGeneratedSourceMap } from "./source-map.ts";
import { stripQuery } from "./source.ts";

export type {
  DirectiveKind,
  TransformManifest,
  TransformManifestFunction,
  TransformManifestImportEdge,
  TransformMetadata,
  TransformMetadataEntry,
  TransformOptions,
  TransformResult,
} from "../types/vite.ts";
export { WorkflowTransformError } from "./error.ts";

interface DirectiveFunction {
  readonly kind: DirectiveKind;
  readonly name: string;
  readonly node: OxcFunction | VariableDeclarator;
  readonly body: FunctionBody;
  readonly parameters: readonly ParamPattern[];
  readonly directive: Statement;
}

const JS_TS_EXTENSION_PATTERN = /\.[cm]?[jt]sx?$/;
const GENERATED_CONTEXT_NAME = makeGeneratedName("context");
const GENERATED_DEFINE_WORKFLOW_NAME = makeGeneratedName("implementWorkflow");
const GENERATED_DEFINE_WORKFLOW_STEP_NAME = makeGeneratedName("defineWorkflowStep");
const GENERATED_ATTACH_WORKFLOW_DEFINITION_NAME = makeGeneratedName("attachWorkflowDefinition");
const GENERATED_ATTACH_WORKFLOW_STEP_DEFINITION_NAME = makeGeneratedName(
  "attachWorkflowStepDefinition",
);
const GENERATED_CALL_WORKFLOW_STEP_FUNCTION_NAME = makeGeneratedName("callWorkflowStepFunction");

/** Transforms one TypeScript module containing workflow or step directives. */
export function transformWorkflowSource(
  code: string,
  id: string,
  options: TransformOptions = {},
): TransformResult | undefined {
  if (!JS_TS_EXTENSION_PATTERN.test(stripQuery(id)) || !hasWorkflowTransformCandidateText(code)) {
    return undefined;
  }

  const sourceFile = parseWorkflowSource(id, code);
  const directiveFunctions = collectDirectiveFunctions(sourceFile.program);
  const file = relativeFile(id, options.root);
  const reExportedFunctions = collectReExportedManifestFunctions(
    sourceFile.program,
    file,
    options.manifests ?? [],
  );
  if (directiveFunctions.length === 0 && reExportedFunctions.length === 0) {
    return undefined;
  }

  const editor = new SourceEditor(code);
  for (const entry of directiveFunctions) {
    editor.remove(leadingTriviaStart(code, entry.directive.start), entry.directive.end);
  }
  const entries = directiveFunctions.map((entry) => createMetadataEntry(entry, file, options));
  const localFunctions = directiveFunctions.map((entry, index) =>
    createManifestFunction(entry, entries[index]!),
  );
  const workflowByName = new Map(
    directiveFunctions
      .filter((entry) => entry.kind === "workflow")
      .map((entry) => [entry.name, entry]),
  );
  const localStepNames = new Set(
    directiveFunctions.filter((entry) => entry.kind === "step").map((entry) => entry.name),
  );

  const importedSteps = collectImportedStepBindings(
    sourceFile.program,
    file,
    options.manifests ?? [],
  );
  const knownStepNames = new Set([...localStepNames, ...importedSteps.keys()]);

  const importText =
    directiveFunctions.length === 0 ? "" : createRuntimeImportText(options.runtimeImport);
  const definitionText = entries
    .map((entry, index) => createDefinitionText(directiveFunctions[index]!, entry, sourceFile))
    .join("\n\n");
  const transformedCode = editor.toString();
  const sourceText =
    directiveFunctions.length === 0 ? transformedCode.trim() : transformedCode.trimEnd();
  const codeParts = [importText, sourceText, definitionText].filter((part) => part !== "");
  const transformedResultCode = `${codeParts.join("\n\n")}\n`;

  return {
    code: transformedResultCode,
    ...(options.sourcemap === true
      ? {
          map: createGeneratedSourceMap({
            id,
            originalCode: sourceFile.text,
            generatedCode: transformedResultCode,
            generatedSource: transformedCode,
            sourceText,
          }),
        }
      : {}),
    metadata: {
      file,
      entries,
    },
    manifest: {
      file,
      functions: [...localFunctions, ...reExportedFunctions],
      imports: [...importedSteps.values()],
    },
  };

  function createDefinitionText(
    entry: DirectiveFunction,
    metadata: TransformMetadataEntry,
    currentSourceFile: WorkflowSourceFile,
  ): string {
    const config = createDefinitionConfig(metadata);
    if (entry.kind === "step") {
      const contextName = uniqueName(
        GENERATED_CONTEXT_NAME,
        entry.parameters.map((parameter, index) => {
          const name = parameterName(parameter);
          if (name === undefined) {
            WorkflowTransformError.directiveParametersMustBeIdentifiers();
          }
          return name || `arg${index}`;
        }),
      );
      return [
        `const ${metadata.generatedName} = ${GENERATED_DEFINE_WORKFLOW_STEP_NAME}(${config}, async (${[
          ...entry.parameters.map((parameter) => spanText(currentSourceFile, parameter)),
          contextName,
        ].join(", ")}) => {`,
        bodyWithoutDirective(entry.body, currentSourceFile),
        "});",
        `${GENERATED_ATTACH_WORKFLOW_STEP_DEFINITION_NAME}(${entry.name}, ${metadata.generatedName});`,
      ].join("\n");
    }

    const workflow = workflowByName.get(entry.name);
    if (workflow === undefined) {
      WorkflowTransformError.metadataMissing(entry.name);
    }
    return [
      `const ${metadata.generatedName} = ${GENERATED_DEFINE_WORKFLOW_NAME}(${config}, async (${GENERATED_CONTEXT_NAME}) => {`,
      createWorkflowBody(workflow, currentSourceFile, knownStepNames),
      "});",
      `${GENERATED_ATTACH_WORKFLOW_DEFINITION_NAME}(${entry.name}, ${metadata.generatedName});`,
    ].join("\n");
  }
}

function hasWorkflowTransformCandidateText(code: string): boolean {
  return (
    code.includes('"use workflow"') ||
    code.includes("'use workflow'") ||
    code.includes('"use step"') ||
    code.includes("'use step'") ||
    code.includes(" from ")
  );
}

function collectDirectiveFunctions(sourceFile: Program): readonly DirectiveFunction[] {
  const entries: DirectiveFunction[] = [];
  for (const statement of sourceFile.body) {
    for (const entry of directiveFunctionsFromStatement(statement)) {
      entries.push(entry);
    }
  }
  rejectNestedDirectiveFunctions(sourceFile, new Set(entries.map((entry) => entry.body)));
  return entries;
}

function directiveFunctionsFromStatement(
  statement: Program["body"][number],
): readonly DirectiveFunction[] {
  const declaration =
    statement.type === "ExportNamedDeclaration" && statement.declaration !== null
      ? statement.declaration
      : statement;
  if (isFunctionDeclaration(declaration)) {
    const entry = directiveFunctionFromDeclaration(declaration);
    return entry === undefined ? [] : [entry];
  }
  if (declaration.type !== "VariableDeclaration") {
    return [];
  }
  return declaration.declarations.flatMap((variableDeclaration) => {
    const entry = directiveFunctionFromVariableDeclaration(variableDeclaration);
    return entry === undefined ? [] : [entry];
  });
}

function directiveFunctionFromDeclaration(node: OxcFunction): DirectiveFunction | undefined {
  if (node.body === null) {
    return undefined;
  }
  const directive = directiveFromBody(node.body);
  if (directive === undefined) {
    return undefined;
  }
  if (node.id === null) {
    WorkflowTransformError.directiveFunctionMustBeNamed();
  }
  rejectUnsupportedDirectiveFunction(node, directive.kind, node.id.name);
  return {
    kind: directive.kind,
    name: node.id.name,
    node,
    body: node.body,
    parameters: node.params,
    directive: directive.statement,
  };
}

function directiveFunctionFromVariableDeclaration(
  node: VariableDeclarator,
): DirectiveFunction | undefined {
  if (node.id.type !== "Identifier" || node.init === null) {
    return undefined;
  }
  const initializer = node.init;
  if (!isArrowOrFunctionExpression(initializer)) {
    return undefined;
  }
  if (initializer.body === null || initializer.body.type !== "BlockStatement") {
    return undefined;
  }
  const directive = directiveFromBody(initializer.body);
  if (directive === undefined) {
    return undefined;
  }
  rejectUnsupportedDirectiveFunction(initializer, directive.kind, node.id.name);
  return {
    kind: directive.kind,
    name: node.id.name,
    node,
    body: initializer.body,
    parameters: initializer.params,
    directive: directive.statement,
  };
}

function directiveFromBody(
  body: FunctionBody | BlockStatement,
): { readonly kind: DirectiveKind; readonly statement: Statement } | undefined {
  const firstStatement = body.body[0];
  if (firstStatement === undefined || firstStatement.type !== "ExpressionStatement") {
    return undefined;
  }
  if (firstStatement.expression.type !== "Literal") {
    return undefined;
  }
  if (firstStatement.expression.value === "use workflow") {
    return { kind: "workflow", statement: firstStatement };
  }
  if (firstStatement.expression.value === "use step") {
    return { kind: "step", statement: firstStatement };
  }
  return undefined;
}

function rejectUnsupportedDirectiveFunction(
  node: OxcFunction | ArrowFunctionExpression,
  kind: DirectiveKind,
  name: string,
): void {
  if (node.generator) {
    WorkflowTransformError.directiveFunctionCannotBeGenerator(directiveText(kind), name);
  }
  if (kind === "workflow" && !node.async) {
    WorkflowTransformError.workflowFunctionMustBeAsync(name);
  }
}

function rejectNestedDirectiveFunctions(
  sourceFile: Program,
  topLevelBodies: ReadonlySet<FunctionBody>,
): void {
  visitWorkflowNode(sourceFile, (node) => {
    if (
      isFunctionLike(node) &&
      node.body !== null &&
      node.body.type === "BlockStatement" &&
      !topLevelBodies.has(node.body) &&
      directiveFromBody(node.body) !== undefined
    ) {
      WorkflowTransformError.directivesMustBeTopLevel();
    }
  });
}

function createMetadataEntry(
  entry: DirectiveFunction,
  file: string,
  options: TransformOptions,
): TransformMetadataEntry {
  const workflowName = options.name?.(file, entry.name, entry.kind) ?? `${file}:${entry.name}`;
  const version =
    typeof options.version === "function" ? options.version(file, entry.name) : options.version;
  return {
    kind: entry.kind,
    name: entry.name,
    generatedName: makeGeneratedName(entry.kind, sanitizeIdentifier(entry.name)),
    workflowName,
    ...(version === undefined ? {} : { version }),
  };
}

function createManifestFunction(
  entry: DirectiveFunction,
  metadata: TransformMetadataEntry,
): TransformManifestFunction {
  return {
    kind: entry.kind,
    exportName: entry.name,
    localName: entry.name,
    generatedName: metadata.generatedName,
    workflowName: metadata.workflowName,
    ...(metadata.version === undefined ? {} : { version: metadata.version }),
  };
}

function createDefinitionConfig(metadata: TransformMetadataEntry): string {
  const fields = [`name: ${JSON.stringify(metadata.workflowName)}`];
  if (metadata.version !== undefined) {
    fields.push(`version: ${JSON.stringify(metadata.version)}`);
  }
  return `{ ${fields.join(", ")} }`;
}

function createWorkflowBody(
  entry: DirectiveFunction,
  sourceFile: WorkflowSourceFile,
  localStepNames: ReadonlySet<string>,
): string {
  const names = entry.parameters.map((parameter, index) => {
    const name = parameterName(parameter);
    if (name === undefined) {
      WorkflowTransformError.directiveParametersMustBeIdentifiers();
    }
    return name || `arg${index}`;
  });
  const tuplePattern = names.length === 0 ? "[]" : `[${names.join(", ")}]`;
  const inputLine = `const ${tuplePattern} = ${GENERATED_CONTEXT_NAME}.input;`;
  rejectObviousNondeterministicGlobals(entry, sourceFile);
  const body = rewriteWorkflowCalls(
    bodyWithoutDirective(entry.body, sourceFile),
    sourceFile,
    localStepNames,
    new Set(names),
  );
  return `${inputLine}\n${body}`;
}

function bodyWithoutDirective(body: FunctionBody, sourceFile: WorkflowSourceFile): string {
  const statements = body.body.slice(1);
  if (statements.length === 0) {
    return "";
  }
  const start = leadingTriviaStart(sourceFile.text, statements[0]!.start);
  const end = statements.at(-1)!.end;
  return new SourceEditor(sourceFile.text).read(start, end);
}

function rewriteWorkflowCalls(
  bodyText: string,
  sourceFile: WorkflowSourceFile,
  knownStepNames: ReadonlySet<string>,
  initialLocalNames: ReadonlySet<string>,
): string {
  const wrapped = `async function ${makeGeneratedName("workflow", "body")}() {${bodyText}}`;
  const bodySource = parseWorkflowSource(sourceFile.fileName, wrapped);
  const editor = new SourceEditor(bodyText);
  const offset = wrapped.indexOf(bodyText);
  const wrapper = bodySource.program.body[0];
  if (!isFunctionDeclaration(wrapper) || wrapper.body === null) {
    return bodyText;
  }

  const visit = (node: Node, localNames: ReadonlySet<string>): void => {
    if (
      isCallExpression(node) &&
      isIdentifier(node.callee) &&
      knownStepNames.has(node.callee.name) &&
      !localNames.has(node.callee.name)
    ) {
      const args = node.arguments.map((argument) => spanText(bodySource, argument)).join(", ");
      editor.replace(
        node.start - offset,
        node.end - offset,
        `${GENERATED_CALL_WORKFLOW_STEP_FUNCTION_NAME}(${GENERATED_CONTEXT_NAME}.step, ${node.callee.name}${
          args === "" ? "" : `, ${args}`
        })`,
      );
      return;
    }
    if (isBlockStatement(node)) {
      visitBlock(node, localNames);
      return;
    }
    if (isFunctionLike(node)) {
      visitFunctionLike(node, localNames);
      return;
    }
    if (node.type === "ForStatement") {
      visitForStatement(node, localNames);
      return;
    }
    if (node.type === "ForInStatement" || node.type === "ForOfStatement") {
      visitForInOrOfStatement(node, localNames);
      return;
    }
    if (node.type === "CatchClause") {
      visitCatchClause(node, localNames);
      return;
    }
    if (node.type === "SwitchStatement") {
      visitSwitchStatement(node, localNames);
      return;
    }
    for (const child of workflowNodeChildren(node)) {
      visit(child, localNames);
    }
  };

  const visitBlock = (block: BlockStatement, inheritedLocalNames: ReadonlySet<string>): void => {
    const localNames = collectBlockLocalNames(block, inheritedLocalNames);
    for (const statement of block.body) {
      visit(statement, localNames);
    }
  };

  const visitFunctionLike = (
    node: OxcFunction | ArrowFunctionExpression,
    inheritedLocalNames: ReadonlySet<string>,
  ): void => {
    const localNames = new Set(inheritedLocalNames);
    if (node.type !== "ArrowFunctionExpression" && node.id !== null) {
      localNames.add(node.id.name);
    }
    for (const parameter of node.params) {
      collectParameterNames(parameter, localNames);
    }
    const body = node.body;
    if (body !== null) {
      visit(body, localNames);
    }
  };

  const visitForStatement = (
    node: ForStatement,
    inheritedLocalNames: ReadonlySet<string>,
  ): void => {
    const localNames = new Set(inheritedLocalNames);
    if (node.init !== null) {
      collectForInitializerNames(node.init, localNames);
      visit(node.init, inheritedLocalNames);
    }
    if (node.test !== null) {
      visit(node.test, localNames);
    }
    if (node.update !== null) {
      visit(node.update, localNames);
    }
    visit(node.body, localNames);
  };

  const visitForInOrOfStatement = (
    node: ForInStatement | ForOfStatement,
    inheritedLocalNames: ReadonlySet<string>,
  ): void => {
    const localNames = new Set(inheritedLocalNames);
    collectForInitializerNames(node.left, localNames);
    visit(node.right, inheritedLocalNames);
    visit(node.body, localNames);
  };

  const visitCatchClause = (node: CatchClause, inheritedLocalNames: ReadonlySet<string>): void => {
    const localNames = new Set(inheritedLocalNames);
    if (node.param !== null) {
      collectBindingNames(node.param, localNames);
    }
    visit(node.body, localNames);
  };

  const visitSwitchStatement = (
    node: SwitchStatement,
    inheritedLocalNames: ReadonlySet<string>,
  ): void => {
    visit(node.discriminant, inheritedLocalNames);
    const localNames = collectSwitchCaseBlockLocalNames(node, inheritedLocalNames);
    for (const clause of node.cases) {
      if (clause.test !== null) {
        visit(clause.test, localNames);
      }
      for (const statement of clause.consequent) {
        visit(statement, localNames);
      }
    }
  };

  visitBlock(wrapper.body, initialLocalNames);
  return editor.toString();
}

function collectBlockLocalNames(
  block: BlockStatement,
  inheritedLocalNames: ReadonlySet<string>,
): ReadonlySet<string> {
  const localNames = new Set(inheritedLocalNames);
  for (const statement of block.body) {
    collectStatementLocalNames(statement, localNames);
  }
  return localNames;
}

function collectSwitchCaseBlockLocalNames(
  switchStatement: SwitchStatement,
  inheritedLocalNames: ReadonlySet<string>,
): ReadonlySet<string> {
  const localNames = new Set(inheritedLocalNames);
  for (const clause of switchStatement.cases) {
    for (const statement of clause.consequent) {
      collectStatementLocalNames(statement, localNames);
    }
  }
  return localNames;
}

function collectStatementLocalNames(statement: Statement, localNames: Set<string>): void {
  if (statement.type === "VariableDeclaration") {
    for (const declaration of statement.declarations) {
      collectBindingNames(declaration.id, localNames);
    }
    return;
  }
  if (isFunctionDeclaration(statement) && statement.id !== null) {
    localNames.add(statement.id.name);
    return;
  }
  if (isClassDeclaration(statement) && statement.id !== null) {
    localNames.add(statement.id.name);
  }
}

function collectForInitializerNames(initializer: Node, localNames: Set<string>): void {
  if (initializer.type === "VariableDeclaration") {
    for (const declaration of initializer.declarations) {
      collectBindingNames(declaration.id, localNames);
    }
  }
}

function collectParameterNames(parameter: ParamPattern, localNames: Set<string>): void {
  if (parameter.type === "TSParameterProperty") {
    collectParameterNames(parameter.parameter, localNames);
    return;
  }
  if (parameter.type === "RestElement") {
    collectBindingNames(parameter.argument, localNames);
    return;
  }
  collectBindingNames(parameter, localNames);
}

function collectBindingNames(
  name: BindingPattern | BindingRestElement,
  localNames: Set<string>,
): void {
  if (name.type === "Identifier") {
    localNames.add(name.name);
    return;
  }
  if (name.type === "RestElement") {
    collectBindingNames(name.argument, localNames);
    return;
  }
  if (name.type === "AssignmentPattern") {
    collectBindingNames(name.left, localNames);
    return;
  }
  if (name.type === "ObjectPattern") {
    for (const property of name.properties) {
      if (property.type === "RestElement") {
        collectBindingNames(property.argument, localNames);
        continue;
      }
      collectBindingNames(property.value, localNames);
    }
    return;
  }
  for (const element of name.elements) {
    if (element !== null) {
      collectBindingNames(element, localNames);
    }
  }
}

function parameterName(parameter: ParamPattern): string | undefined {
  if (parameter.type === "Identifier") {
    return parameter.name;
  }
  return undefined;
}

function isIdentifier(node: Node): node is BindingIdentifier {
  return node.type === "Identifier";
}

function isFunctionDeclaration(
  node: Node,
): node is OxcFunction & { readonly type: "FunctionDeclaration" } {
  return node.type === "FunctionDeclaration";
}

function isClassDeclaration(node: Node): node is Class & { readonly type: "ClassDeclaration" } {
  return node.type === "ClassDeclaration";
}

function isFunctionLike(node: Node): node is OxcFunction | ArrowFunctionExpression {
  return (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  );
}

function isArrowOrFunctionExpression(
  node: Expression,
): node is OxcFunction | ArrowFunctionExpression {
  return node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression";
}

function isBlockStatement(node: Node): node is BlockStatement {
  return node.type === "BlockStatement";
}

function isCallExpression(node: Node): node is CallExpression {
  return node.type === "CallExpression";
}

function uniqueName(base: string, usedNames: readonly string[]): string {
  let name = base;
  let index = 1;
  const used = new Set(usedNames);
  while (used.has(name)) {
    name = `${base}_${index}`;
    index++;
  }
  return name;
}

function createRuntimeImportText(specifier = "@temelj/workflow"): string {
  return [
    "import {",
    `  implementWorkflow as ${GENERATED_DEFINE_WORKFLOW_NAME},`,
    `  defineWorkflowStep as ${GENERATED_DEFINE_WORKFLOW_STEP_NAME},`,
    `  attachWorkflowDefinition as ${GENERATED_ATTACH_WORKFLOW_DEFINITION_NAME},`,
    `  attachWorkflowStepDefinition as ${GENERATED_ATTACH_WORKFLOW_STEP_DEFINITION_NAME},`,
    `  callWorkflowStepFunction as ${GENERATED_CALL_WORKFLOW_STEP_FUNCTION_NAME},`,
    `} from ${JSON.stringify(specifier)};`,
  ].join("\n");
}

function relativeFile(id: string, root = process.cwd()): string {
  const cleanId = stripQuery(id);
  const relative = path.relative(root, cleanId).replaceAll(path.sep, "/");
  return relative.startsWith("..") ? path.basename(cleanId) : relative;
}

function sanitizeIdentifier(value: string): string {
  const sanitized = value.replaceAll(/\W/g, "_");
  return /^\d/.test(sanitized) ? `_${sanitized}` : sanitized;
}

function directiveText(kind: DirectiveKind): string {
  return kind === "workflow" ? "use workflow" : "use step";
}
