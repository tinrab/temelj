import type { BindingIdentifier, CallExpression, Node, ParserOptions, Program } from "oxc-parser";

import { parseSync, visitorKeys } from "oxc-parser";

import { workflowSourceKindForId } from "./source.ts";

type AstNode = Node | Program;

export interface SourceFile {
  readonly fileName: string;
  readonly text: string;
  readonly program: Program;
}

interface WorkflowSpan {
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

export function parseSource(fileName: string, text: string): SourceFile {
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

export function spanText(sourceFile: SourceFile, node: WorkflowSpan): string {
  return sourceFile.text.slice(node.start, node.end);
}

export function leadingTriviaStart(text: string, start: number): number {
  let index = start;

  while (index > 0 && /\s/.test(text[index - 1]!)) {
    index--;
  }

  return index;
}

interface SourcePosition {
  readonly line: number;
  readonly column: number;
}

export function lineAndColumnOfPosition(text: string, position: number): SourcePosition {
  const prefix = text.slice(0, position);
  const lines = prefix.split(/\r\n|\r|\n/);

  return {
    line: lines.length,
    column: lines.at(-1)!.length + 1,
  };
}

export function visitNode(node: AstNode, visitor: (node: AstNode) => void): void {
  for (const child of workflowNodeChildren(node)) {
    visitor(child);
    visitNode(child, visitor);
  }
}

export function workflowNodeChildren(node: AstNode): readonly AstNode[] {
  const children: AstNode[] = [];
  const keys = visitorKeys[node.type] ?? [];

  for (const [key, value] of Object.entries(node)) {
    if (!keys.includes(key) || NON_RUNTIME_AST_KEYS.has(key)) {
      continue;
    }

    // SAFETY: Oxc visitor keys identify only node or node-array fields on its parsed AST.
    const child = value as AstNode | (AstNode | null)[] | null | undefined;

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

export function isIdentifier(node: Node): node is BindingIdentifier {
  return node.type === "Identifier";
}

export function isCallExpression(node: Node): node is CallExpression {
  return node.type === "CallExpression";
}
