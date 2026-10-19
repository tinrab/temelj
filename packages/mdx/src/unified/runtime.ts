import type { Processor as UnifiedProcessor } from "unified";

import { isString, isPlainObject, isPromise } from "@temelj/value";
import { unified } from "unified";
import { VFile } from "vfile";

type VFileMessage = VFile["messages"][number];

import type { Diagnostic, DiagnosticReporter } from "../diagnostics.ts";
import type { HtmlRootNode } from "../html.ts";
import type { DocumentNode } from "../model.ts";
import type { DocumentPluginContext, HtmlPluginContext } from "../plugin.ts";
import type { SourceFile } from "../source.ts";

import { ConfigurationError } from "../errors.ts";
import { UnifiedTreeBridge } from "./tree-bridge.ts";

export type UnifiedAttach = (processor: UnifiedProcessor) => void;

interface UnifiedTransformContext {
  readonly diagnostics: DiagnosticReporter;
  readonly file: SourceFile;
}

interface TreeCodec<TDocument> {
  readonly ecosystem: string;
  decode(tree: unknown): TDocument;
  encode(document: TDocument): Readonly<{ type: string }>;
}

export function runRemarkPlugin(
  context: DocumentPluginContext,
  attach: UnifiedAttach,
): DocumentNode | Promise<DocumentNode> {
  const bridge = new UnifiedTreeBridge(context.file);

  return runUnifiedTransform(context.document, context, attach, {
    ecosystem: "Remark",
    decode: (tree) => bridge.fromMdast(tree),
    encode: (document) => bridge.toMdast(document),
  });
}

export function runRehypePlugin(
  context: HtmlPluginContext,
  attach: UnifiedAttach,
): HtmlRootNode | Promise<HtmlRootNode> {
  const bridge = new UnifiedTreeBridge(context.file);

  return runUnifiedTransform(context.root, context, attach, {
    ecosystem: "Rehype",
    decode: (tree) => bridge.fromHast(tree),
    encode: (document) => bridge.toHast(document),
  });
}

function runUnifiedTransform<TDocument>(
  original: TDocument,
  context: UnifiedTransformContext,
  attach: UnifiedAttach,
  codec: TreeCodec<TDocument>,
): TDocument | Promise<TDocument> {
  const file = new VFile({ value: context.file.text });
  const processor = unified();
  attach(processor);
  processor.freeze();

  if (processor.parser !== undefined || processor.compiler !== undefined) {
    throw ConfigurationError.unsupportedUnifiedPlugin();
  }

  let result: Readonly<{ type: string }> | Promise<Readonly<{ type: string }>>;

  try {
    result = runPossiblyAsync(processor, codec.encode(original), file, codec.ecosystem);
  } catch (cause) {
    recordMessages(file, context.diagnostics, context.file);
    throw cause;
  }

  const accept = (tree: Readonly<{ type: string }>): TDocument =>
    recordMessages(file, context.diagnostics, context.file) ? original : codec.decode(tree);

  return isPromise(result)
    ? result.then(accept, (cause: unknown) => {
        recordMessages(file, context.diagnostics, context.file);
        throw cause;
      })
    : accept(result);
}

function runPossiblyAsync(
  processor: UnifiedProcessor,
  tree: Readonly<{ type: string }>,
  file: VFile,
  ecosystem: string,
): Readonly<{ type: string }> | Promise<Readonly<{ type: string }>> {
  let complete = false;
  let failure: Error | undefined;
  let result = stageRoot(tree, ecosystem);

  let finish = (error: Error | null | undefined, transformed: unknown): void => {
    failure = error ?? undefined;

    if (error === undefined || error === null) {
      result = stageRoot(transformed, ecosystem);
    }

    complete = true;
  };

  processor.run(tree, file, (error, transformed) => {
    finish(error, transformed);
  });

  if (complete) {
    if (failure !== undefined) {
      throw failure;
    }

    return result;
  }

  return new Promise((resolve, reject) => {
    finish = (error, transformed) => {
      if (error === undefined || error === null) {
        try {
          resolve(stageRoot(transformed, ecosystem));
        } catch (cause) {
          reject(cause);
        }
      } else {
        reject(error);
      }
    };
  });
}

function stageRoot(node: unknown, ecosystem: string): Readonly<{ type: string }> {
  if (isRoot(node)) {
    return node;
  }

  if (!isPlainObject(node) || !("type" in node)) {
    throw new TypeError(`${ecosystem} returned a malformed tree instead of root`);
  }

  const type = node.type;

  if (!isString(type)) {
    throw new TypeError(`${ecosystem} returned a malformed tree instead of root`);
  }

  throw new TypeError(`${ecosystem} returned ${JSON.stringify(type)} instead of root`);
}

function isRoot(node: unknown): node is Readonly<{ type: "root" }> {
  return isPlainObject(node) && "type" in node && node.type === "root";
}

type UnifiedDiagnostic = { -readonly [K in keyof Diagnostic]: Diagnostic[K] };

function recordMessages(
  file: VFile,
  diagnostics: DiagnosticReporter,
  sourceFile: SourceFile,
): boolean {
  let fatal = false;

  for (const message of file.messages) {
    fatal ||= message.fatal === true;
    const span = messageSpan(message, sourceFile);

    const diagnostic: UnifiedDiagnostic = {
      severity: message.fatal === true ? "error" : message.fatal === false ? "warning" : "info",
      code: "mdx.plugin.unified",
      message: message.reason,
    };

    if (span !== undefined) {
      diagnostic.span = span;
    }

    const notes: string[] = [];

    if (message.source !== undefined) {
      notes.push(`source: ${message.source}`);
    }

    if (message.ruleId !== undefined) {
      notes.push(`rule: ${message.ruleId}`);
    }

    if (message.note !== undefined) {
      notes.push(message.note);
    }

    if (notes.length > 0) {
      diagnostic.notes = notes;
    }

    diagnostics.add(diagnostic);
  }

  return fatal;
}

function messageSpan(
  message: VFileMessage,
  file: SourceFile,
): { file: SourceFile; start: number; end: number } | undefined {
  const place = message.place;

  if (place === undefined) {
    return undefined;
  }

  const startPoint = "start" in place ? place.start : place;
  const endPoint = "end" in place ? place.end : place;

  if (startPoint.offset === undefined || endPoint.offset === undefined) {
    return undefined;
  }

  if (
    startPoint.offset < 0 ||
    endPoint.offset < startPoint.offset ||
    endPoint.offset > file.length
  ) {
    return undefined;
  }

  return { file, start: startPoint.offset, end: endPoint.offset };
}
