import { parseSync, type Node, type ParserOptions, type Program } from "oxc-parser";

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

export function lineAndColumnOfPosition(
  text: string,
  position: number,
): { readonly line: number; readonly column: number } {
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
  for (const [key, value] of Object.entries(node)) {
    if (
      key === "parent" ||
      key === "decorators" ||
      key === "typeAnnotation" ||
      key === "typeArguments" ||
      key === "typeParameters" ||
      key === "returnType"
    ) {
      continue;
    }
    if (isWorkflowAstNode(value)) {
      children.push(value);
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isWorkflowAstNode(item)) {
          children.push(item);
        }
      }
    }
  }
  return children;
}

function isWorkflowAstNode(value: unknown): value is WorkflowAstNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { readonly type?: unknown }).type === "string" &&
    typeof (value as { readonly start?: unknown }).start === "number" &&
    typeof (value as { readonly end?: unknown }).end === "number"
  );
}
