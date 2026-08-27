import type { Processor as UnifiedProcessor } from "unified";

import { isPlainObject, isPromise } from "@temelj/value";
import { unified } from "unified";
import { VFile } from "vfile";

type VFileMessage = VFile["messages"][number];

import type { DiagnosticReporter } from "../diagnostics.ts";
import type { HtmlDocumentNode } from "../html.ts";
import type { DocumentNode, SourceFile } from "../model.ts";
import type { DocumentTransformContext, HtmlTransformContext } from "../plugin.ts";

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
  context: DocumentTransformContext,
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
  context: HtmlTransformContext,
  attach: UnifiedAttach,
): HtmlDocumentNode | Promise<HtmlDocumentNode> {
  const bridge = new UnifiedTreeBridge(context.file);
  return runUnifiedTransform(context.document, context, attach, {
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
    ConfigurationError.unsupportedUnifiedPlugin();
  }

  try {
    const result = runPossiblyAsync(processor, codec.encode(original), file, codec.ecosystem);
    return mapPossiblePromise(
      result,
      (tree) =>
        recordMessages(file, context.diagnostics, context.file) ? original : codec.decode(tree),
      (cause) => recoverFromFailure(original, cause, file, context),
    );
  } catch (cause) {
    return recoverFromFailure(original, cause, file, context);
  }
}

function runPossiblyAsync(
  processor: UnifiedProcessor,
  tree: Readonly<{ type: string }>,
  file: VFile,
  ecosystem: string,
): Record<string, unknown> | Promise<Record<string, unknown>> {
  let complete = false;
  let failure: Error | undefined;
  let result = stageRoot(tree, ecosystem);
  let finish = (error: Error | null | undefined, transformed: unknown): void => {
    failure = error ?? undefined;
    result = stageRoot(transformed, ecosystem);
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
        resolve(stageRoot(transformed, ecosystem));
      } else {
        reject(error);
      }
    };
  });
}

function mapPossiblePromise<TInput, TOutput>(
  input: TInput | PromiseLike<TInput>,
  map: (value: TInput) => TOutput,
  reject: (cause: unknown) => TOutput,
): TOutput | Promise<TOutput> {
  return isPromise(input) ? Promise.resolve(input).then(map).catch(reject) : map(input);
}

function recoverFromFailure<TDocument>(
  original: TDocument,
  cause: unknown,
  file: VFile,
  context: UnifiedTransformContext,
): TDocument {
  if (recordMessages(file, context.diagnostics, context.file)) {
    return original;
  }
  throw cause;
}

function stageRoot(node: unknown, ecosystem: string): Record<string, unknown> {
  if (!isPlainObject(node)) {
    throw new TypeError(`${ecosystem} returned a malformed tree instead of root`);
  }
  const type = node.type;
  if (typeof type !== "string") {
    throw new TypeError(`${ecosystem} returned a malformed tree instead of root`);
  }
  if (type !== "root") {
    throw new TypeError(`${ecosystem} returned ${JSON.stringify(type)} instead of root`);
  }
  return node;
}

function recordMessages(
  file: VFile,
  diagnostics: DiagnosticReporter,
  sourceFile: SourceFile,
): boolean {
  let fatal = false;
  for (const message of file.messages) {
    fatal ||= message.fatal === true;
    const span = messageSpan(message, sourceFile);
    diagnostics.add({
      severity: message.fatal === true ? "error" : message.fatal === false ? "warning" : "info",
      code: "mdx.plugin.unified",
      message: message.reason,
      ...(span === undefined ? {} : { span }),
      ...(message.note === undefined && message.source === undefined && message.ruleId === undefined
        ? {}
        : {
            notes: [
              ...(message.source === undefined ? [] : [`source: ${message.source}`]),
              ...(message.ruleId === undefined ? [] : [`rule: ${message.ruleId}`]),
              ...(message.note === undefined ? [] : [message.note]),
            ],
          }),
    });
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
    endPoint.offset > file.text.length
  ) {
    return undefined;
  }
  return { file, start: startPoint.offset, end: endPoint.offset };
}
