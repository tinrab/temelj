import { parseSync, visitorKeys, type Node, type ParserOptions, type Program } from "oxc-parser";

import { workflowSourceKindForId } from "./source.ts";

export type WorkflowAstNode = Node | Program;

export interface WorkflowSourceFile {
  readonly fileName: string;
  readonly text: string;
  readonly program: Program;
}

export interface WorkflowSpan {
  readonly start: number;
  readonly end: number;
}

const PARSER_OPTIONS_BY_SOURCE_KIND = {
  js: { lang: "js", astType: "js" },
  json: { lang: "js", astType: "js" },
  ts: { lang: "ts", astType: "ts" },
  tsx: { lang: "tsx", astType: "ts" },
} as const satisfies Record<
  ReturnType<typeof workflowSourceKindForId>,
  Pick<ParserOptions, "astType" | "lang">
>;

export function parseWorkflowSource(fileName: string, text: string): WorkflowSourceFile {
  const result = parseSync(fileName, text, {
    ...PARSER_OPTIONS_BY_SOURCE_KIND[workflowSourceKindForId(fileName)],
    sourceType: "module",
  });

  if (result.errors.length > 0) {
    throw new Error(result.errors.map((error) => error.message).join("\n"));
  }

  return {
    fileName,
    text,
    program: result.program,
  };
}

export function spanText(sourceFile: WorkflowSourceFile, node: WorkflowSpan): string {
  return sourceFile.text.slice(node.start, node.end);
}

export function leadingTriviaStart(text: string, start: number): number {
  let index = start;

  while (index > 0 && /\s/.test(text[index - 1]!)) {
    index--;
  }

  return index;
}

export interface WorkflowSourcePosition {
  readonly line: number;
  readonly column: number;
}

export function lineAndColumnOfPosition(text: string, position: number): WorkflowSourcePosition {
  const prefix = text.slice(0, position);
  const lines = prefix.split(/\r\n|\r|\n/);

  return {
    line: lines.length,
    column: lines.at(-1)!.length + 1,
  };
}

export function visitWorkflowNode(
  node: WorkflowAstNode,
  visitor: (node: WorkflowAstNode) => void,
): void {
  for (const child of workflowNodeChildren(node)) {
    visitor(child);
    visitWorkflowNode(child, visitor);
  }
}

export function workflowNodeChildren(node: WorkflowAstNode): readonly WorkflowAstNode[] {
  const children: WorkflowAstNode[] = [];
  const keys = visitorKeys[node.type] ?? [];

  for (const [key, value] of Object.entries(node)) {
    if (!keys.includes(key) || NON_RUNTIME_AST_KEYS.has(key)) {
      continue;
    }

    // SAFETY: Oxc visitor keys identify only node or node-array fields on its parsed AST.
    const child = value as WorkflowAstNode | (WorkflowAstNode | null)[] | null | undefined;

    if (Array.isArray(child)) {
      for (const item of child) {
        if (item !== null) {
          children.push(item);
        }
      }
    } else if (child !== null && child !== undefined) {
      children.push(child);
    }
  }

  return children;
}

const NON_RUNTIME_AST_KEYS = new Set([
  "decorators",
  "typeAnnotation",
  "typeArguments",
  "typeParameters",
  "returnType",
]);
