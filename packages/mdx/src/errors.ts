import type { SchemaIssue } from "@temelj/standard-schema";

import type { Diagnostic } from "./diagnostics.ts";
import type { ParserLimit } from "./parser/config.ts";
import type { SourceRange } from "./ranges.ts";
import type { SourceFile } from "./source.ts";

import { createDiagnostic, formatDiagnostic } from "./diagnostics.ts";

export abstract class MdxError extends Error {
  protected constructor(
    name: string,
    message: string,
    options: ErrorOptions = {},
    context?: Function,
  ) {
    super(message, options);
    this.name = name;

    if (Error.captureStackTrace !== undefined) {
      Error.captureStackTrace(this, context ?? this.constructor);
    }
  }
}

export type InputIssue =
  | Readonly<{ kind: "htmlTagName"; name: string }>
  | Readonly<{
      kind: "mathDelimiterCollision";
      format: "tex";
      nodeKind: "inlineMath" | "displayMath";
      delimiter: "\\)" | "\\]";
    }>
  | Readonly<{ kind: "mathMetadata"; format: "tex" }>
  | Readonly<{ kind: "replacementRange"; start: number; end: number; sourceLength: number }>
  | Readonly<{ kind: "sourceOffset"; offset: number; sourceLength: number }>
  | Readonly<{ kind: "streamCompleted" }>;

export class InputError extends MdxError {
  public readonly issue: InputIssue;

  private constructor(message: string, issue: InputIssue, context: Function) {
    super("InputError", message, {}, context);
    this.issue = Object.freeze(issue);
  }

  public static mathDelimiterCollision(
    this: void,
    nodeKind: "inlineMath" | "displayMath",
    delimiter: "\\)" | "\\]",
  ): InputError {
    return new InputError(
      `Cannot format ${nodeKind} as TeX because its value contains ${JSON.stringify(delimiter)}`,
      { kind: "mathDelimiterCollision", format: "tex", nodeKind, delimiter },
      InputError.mathDelimiterCollision,
    );
  }

  public static mathMetadataUnsupported(this: void): InputError {
    return new InputError(
      "TeX display math does not support fence metadata",
      { kind: "mathMetadata", format: "tex" },
      InputError.mathMetadataUnsupported,
    );
  }

  public static invalidHtmlTagName(this: void, name: string): InputError {
    return new InputError(
      `Invalid HTML tag name: ${name}`,
      { kind: "htmlTagName", name },
      InputError.invalidHtmlTagName,
    );
  }

  public static replacementRangeOutsideSource(
    this: void,
    start: number,
    end: number,
    sourceLength: number,
  ): InputError {
    return new InputError(
      `Replacement range ${start}..${end} is outside source of length ${sourceLength}`,
      { kind: "replacementRange", start, end, sourceLength },
      InputError.replacementRangeOutsideSource,
    );
  }

  public static sourceOffsetOutsideFile(
    this: void,
    offset: number,
    sourceLength: number,
  ): InputError {
    return new InputError(
      `Source offset ${offset} is outside file of length ${sourceLength}`,
      { kind: "sourceOffset", offset, sourceLength },
      InputError.sourceOffsetOutsideFile,
    );
  }

  public static streamCompleted(this: void): InputError {
    return new InputError(
      "A successfully completed MdxStream cannot be changed",
      { kind: "streamCompleted" },
      InputError.streamCompleted,
    );
  }
}

export type ConfigurationIssue =
  | Readonly<{ kind: "asynchronousPluginInSynchronousProcessor" }>
  | Readonly<{ kind: "cacheCapacity"; pluginName: string; capacity: number }>
  | Readonly<{ kind: "compilerLimit"; option: string; value: number }>
  | Readonly<{ kind: "parserLimit"; option: string; value: number; minimum: number }>
  | Readonly<{
      kind: "pluginIntegerOption";
      pluginName: string;
      option: string;
      value: number;
      minimum: number;
    }>
  | Readonly<{ kind: "streamLimit"; option: string; value: number; minimum: number }>
  | Readonly<{ kind: "unifiedPlugin" }>;

export class ConfigurationError extends MdxError {
  public readonly issue: ConfigurationIssue;

  private constructor(message: string, issue: ConfigurationIssue, context: Function) {
    super("ConfigurationError", message, {}, context);
    this.issue = Object.freeze(issue);
  }

  public static asynchronousPluginInSynchronousProcessor(this: void): ConfigurationError {
    return new ConfigurationError(
      "processSync() cannot run an asynchronous plugin; use process() instead",
      { kind: "asynchronousPluginInSynchronousProcessor" },
      ConfigurationError.asynchronousPluginInSynchronousProcessor,
    );
  }

  public static unsupportedUnifiedPlugin(this: void): ConfigurationError {
    return new ConfigurationError(
      "Unified parser and compiler plugins are not supported by the transform adapter",
      { kind: "unifiedPlugin" },
      ConfigurationError.unsupportedUnifiedPlugin,
    );
  }

  public static invalidCacheCapacity(
    this: void,
    pluginName: string,
    capacity: number,
  ): ConfigurationError {
    return new ConfigurationError(
      `Invalid ${pluginName} cache capacity: ${capacity}; expected a non-negative safe integer`,
      { kind: "cacheCapacity", pluginName, capacity },
      ConfigurationError.invalidCacheCapacity,
    );
  }

  public static invalidCompilerLimit(
    this: void,
    option: string,
    value: number,
  ): ConfigurationError {
    return new ConfigurationError(
      `Invalid compiler ${option}: ${value}; expected a non-negative safe integer`,
      { kind: "compilerLimit", option, value },
      ConfigurationError.invalidCompilerLimit,
    );
  }

  public static invalidStreamLimit(
    this: void,
    option: string,
    value: number,
    minimum: number,
  ): ConfigurationError {
    return new ConfigurationError(
      `Invalid stream ${option}: ${value}; expected a safe integer of at least ${minimum}`,
      { kind: "streamLimit", option, value, minimum },
      ConfigurationError.invalidStreamLimit,
    );
  }

  public static invalidParserLimit(
    this: void,
    option: string,
    value: number,
    minimum: number,
  ): ConfigurationError {
    return new ConfigurationError(
      `Invalid parser ${option}: ${value}; expected a safe integer of at least ${minimum}`,
      { kind: "parserLimit", option, value, minimum },
      ConfigurationError.invalidParserLimit,
    );
  }

  public static invalidPluginIntegerOption(
    this: void,
    pluginName: string,
    option: string,
    value: number,
    minimum: number,
  ): ConfigurationError {
    return new ConfigurationError(
      `Invalid ${pluginName} ${option}: ${value}; expected a safe integer of at least ${minimum}`,
      { kind: "pluginIntegerOption", pluginName, option, value, minimum },
      ConfigurationError.invalidPluginIntegerOption,
    );
  }
}

export type TransformTarget = "document" | "html";

export interface TransformIssue {
  readonly kind: "threw" | "reported";
  readonly target: TransformTarget;
  readonly pluginName: string;
}

export class TransformError extends MdxError {
  public readonly issue: TransformIssue;
  public readonly file: SourceFile;
  public readonly diagnostics: readonly Diagnostic[];

  private constructor(
    issue: TransformIssue,
    file: SourceFile,
    diagnostics: readonly Diagnostic[],
    options: ErrorOptions,
    context: Function,
  ) {
    super(
      "TransformError",
      `Plugin "${issue.pluginName}" failed while transforming ${issue.target}`,
      options,
      context,
    );
    this.issue = Object.freeze(issue);
    this.file = file;
    this.diagnostics = Object.freeze([...diagnostics]);
  }

  public static pluginTransformFailed(
    this: void,
    target: TransformTarget,
    pluginName: string,
    file: SourceFile,
    diagnostics: readonly Diagnostic[],
    cause: unknown,
  ): TransformError {
    return new TransformError(
      { kind: "threw", target, pluginName },
      file,
      diagnostics,
      { cause },
      TransformError.pluginTransformFailed,
    );
  }

  public static pluginReportedErrors(
    this: void,
    target: TransformTarget,
    pluginName: string,
    file: SourceFile,
    diagnostics: readonly Diagnostic[],
  ): TransformError {
    return new TransformError(
      { kind: "reported", target, pluginName },
      file,
      diagnostics,
      {},
      TransformError.pluginReportedErrors,
    );
  }
}

export type CompilationInvariant =
  | "defaultExportBindingMissing"
  | "jsxAttributeExpressionEmpty"
  | "jsxAttributeNameMissing"
  | "jsxElementNameMissing"
  | "jsxElementOpeningMissing"
  | "jsxIdentifierNameMissing"
  | "jsxMemberExpressionIncomplete"
  | "jsxNamespaceIncomplete"
  | "jsxSpreadArgumentMissing"
  | "multipleDefaultExports"
  | "unsupportedJsxName";

export type CompilationIssue =
  | Readonly<{ kind: "generation" }>
  | Readonly<{ kind: "generatedProgram" }>
  | Readonly<{ kind: "invalidDocument"; invariant: CompilationInvariant; detail?: string }>;

export class CompileError extends MdxError {
  public readonly issue: CompilationIssue;

  private constructor(
    message: string,
    issue: CompilationIssue,
    options: ErrorOptions,
    context: Function,
  ) {
    super("CompileError", message, options, context);
    this.issue = Object.freeze(issue);
  }

  public static generationFailed(this: void, cause: unknown): CompileError {
    return new CompileError(
      "MDX compilation failed",
      { kind: "generation" },
      { cause },
      CompileError.generationFailed,
    );
  }

  public static multipleDefaultExports(this: void): CompileError {
    return CompileError.invalidDocument(
      "multipleDefaultExports",
      "MDX has more than one default export",
      undefined,
      CompileError.multipleDefaultExports,
    );
  }

  public static defaultExportBindingMissing(this: void): CompileError {
    return CompileError.invalidDocument(
      "defaultExportBindingMissing",
      "Default MDX export has no local binding",
      undefined,
      CompileError.defaultExportBindingMissing,
    );
  }

  public static jsxElementOpeningMissing(this: void): CompileError {
    return CompileError.invalidDocument(
      "jsxElementOpeningMissing",
      "JSX element has no opening element",
      undefined,
      CompileError.jsxElementOpeningMissing,
    );
  }

  public static jsxElementNameMissing(this: void): CompileError {
    return CompileError.invalidDocument(
      "jsxElementNameMissing",
      "JSX element has no name",
      undefined,
      CompileError.jsxElementNameMissing,
    );
  }

  public static jsxSpreadArgumentMissing(this: void): CompileError {
    return CompileError.invalidDocument(
      "jsxSpreadArgumentMissing",
      "JSX spread has no argument",
      undefined,
      CompileError.jsxSpreadArgumentMissing,
    );
  }

  public static jsxAttributeNameMissing(this: void): CompileError {
    return CompileError.invalidDocument(
      "jsxAttributeNameMissing",
      "JSX attribute has no name",
      undefined,
      CompileError.jsxAttributeNameMissing,
    );
  }

  public static jsxAttributeExpressionEmpty(this: void): CompileError {
    return CompileError.invalidDocument(
      "jsxAttributeExpressionEmpty",
      "JSX attribute expression is empty",
      undefined,
      CompileError.jsxAttributeExpressionEmpty,
    );
  }

  public static jsxIdentifierNameMissing(this: void): CompileError {
    return CompileError.invalidDocument(
      "jsxIdentifierNameMissing",
      "JSX identifier has no name",
      undefined,
      CompileError.jsxIdentifierNameMissing,
    );
  }

  public static jsxMemberExpressionIncomplete(this: void): CompileError {
    return CompileError.invalidDocument(
      "jsxMemberExpressionIncomplete",
      "JSX member expression is incomplete",
      undefined,
      CompileError.jsxMemberExpressionIncomplete,
    );
  }

  public static jsxNamespaceIncomplete(this: void): CompileError {
    return CompileError.invalidDocument(
      "jsxNamespaceIncomplete",
      "JSX namespace is incomplete",
      undefined,
      CompileError.jsxNamespaceIncomplete,
    );
  }

  public static unsupportedJsxName(this: void, nodeType: string): CompileError {
    return CompileError.invalidDocument(
      "unsupportedJsxName",
      `Unsupported JSX name node: ${nodeType}`,
      nodeType,
      CompileError.unsupportedJsxName,
    );
  }

  public static generatedProgramInvalid(this: void, cause: unknown): CompileError {
    return new CompileError(
      "The generated MDX module is not valid JavaScript",
      { kind: "generatedProgram" },
      { cause },
      CompileError.generatedProgramInvalid,
    );
  }

  private static invalidDocument(
    invariant: CompilationInvariant,
    message: string,
    detail: string | undefined,
    context: Function,
  ): CompileError {
    return new CompileError(
      message,
      {
        kind: "invalidDocument",
        invariant,
        detail,
      },
      {},
      context,
    );
  }
}

export class ParseError extends MdxError {
  public readonly file: SourceFile;
  public readonly diagnostics: readonly [Diagnostic, ...Diagnostic[]];

  private constructor(file: SourceFile, diagnostics: readonly [Diagnostic, ...Diagnostic[]]) {
    super("ParseError", diagnostics[0].message, {}, ParseError.invalidSyntax);
    this.file = file;
    this.diagnostics = Object.freeze([...diagnostics]);
  }

  public static invalidSyntax(
    this: void,
    file: SourceFile,
    diagnostics: readonly [Diagnostic, ...Diagnostic[]],
  ): ParseError {
    return new ParseError(file, diagnostics);
  }
}

export type CompileLimit = "maximumGeneratedCodeBytes" | "maximumSourceMapBytes";

export class LimitError extends MdxError {
  public readonly file: SourceFile;
  public readonly diagnostics: readonly [Diagnostic];
  public readonly limit: ParserLimit | CompileLimit;
  public readonly maximum: number;
  public readonly actual: number | undefined;

  private constructor(
    file: SourceFile,
    limit: ParserLimit | CompileLimit,
    maximum: number,
    range: SourceRange,
    actual?: number,
  ) {
    const message = `MDX limit ${limit} exceeded: maximum ${maximum}${actual === undefined ? "" : `, actual ${actual}`}`;
    super("LimitError", message, {}, LimitError.exceeded);
    this.file = file;
    this.limit = limit;
    this.maximum = maximum;
    this.actual = actual;
    this.diagnostics = Object.freeze([
      createDiagnostic({
        severity: "error",
        code: `mdx.limit.${limit}`,
        message,
        span: { file, ...range },
      }),
    ]);
  }

  public static exceeded(
    this: void,
    file: SourceFile,
    limit: ParserLimit | CompileLimit,
    maximum: number,
    range: SourceRange = { start: 0, end: file.length },
    actual?: number,
  ): LimitError {
    return new LimitError(file, limit, maximum, range, actual);
  }
}

export type FrontmatterIssue =
  | Readonly<{ kind: "schema"; issues: readonly SchemaIssue[] }>
  | Readonly<{ kind: "transport"; reason: string }>;

export class FrontmatterError extends MdxError {
  public readonly file: SourceFile;
  public readonly diagnostics: readonly Diagnostic[];
  public readonly issue: FrontmatterIssue;

  private constructor(
    file: SourceFile,
    diagnostics: readonly Diagnostic[],
    issue: FrontmatterIssue,
    context: Function,
  ) {
    super(
      "FrontmatterError",
      diagnostics[0]?.message ?? "Frontmatter schema validation failed",
      {},
      context,
    );
    this.file = file;
    this.diagnostics = Object.freeze([...diagnostics]);
    this.issue = Object.freeze(issue);
  }

  public static schemaValidationFailed(
    this: void,
    file: SourceFile,
    diagnostics: readonly Diagnostic[],
    issues: readonly SchemaIssue[],
  ): FrontmatterError {
    return new FrontmatterError(
      file,
      diagnostics,
      { kind: "schema", issues: Object.freeze([...issues]) },
      FrontmatterError.schemaValidationFailed,
    );
  }

  public static nonTransportableValue(
    this: void,
    file: SourceFile,
    origin: SourceRange | undefined,
    reason: string,
  ): FrontmatterError {
    const diagnostic = createDiagnostic({
      severity: "error",
      code: "mdx.frontmatter.transport",
      message: "Validated frontmatter must contain transportable values",
      notes: [reason],
      span: origin === undefined ? undefined : { file, ...origin },
    });

    return new FrontmatterError(
      file,
      [diagnostic],
      { kind: "transport", reason },
      FrontmatterError.nonTransportableValue,
    );
  }
}

export type BuildIssue = Readonly<{ kind: "compile" }> | Readonly<{ kind: "asyncDocument" }>;

export class BuildError extends MdxError {
  public readonly filename: string;
  public readonly issue: BuildIssue;

  private constructor(
    message: string,
    filename: string,
    issue: BuildIssue,
    options: ErrorOptions,
    context: Function,
  ) {
    super("BuildError", message, options, context);
    this.filename = filename;
    this.issue = Object.freeze(issue);
  }

  public static compileFailed(this: void, filename: string, cause: MdxError): BuildError {
    const diagnostics: readonly Diagnostic[] =
      cause instanceof ParseError ||
      cause instanceof TransformError ||
      cause instanceof FrontmatterError ||
      cause instanceof LimitError
        ? cause.diagnostics
        : [];

    const lines =
      diagnostics.length === 0
        ? [cause.message]
        : diagnostics.map((diagnostic) => formatDiagnostic(diagnostic));

    return new BuildError(
      lines.map((line) => `${filename}: ${line}`).join("\n"),
      filename,
      { kind: "compile" },
      { cause },
      BuildError.compileFailed,
    );
  }

  public static asyncDocument(this: void, filename: string): BuildError {
    return new BuildError(
      `${filename}: async MDX documents are not supported here; move async work into a route loader`,
      filename,
      { kind: "asyncDocument" },
      {},
      BuildError.asyncDocument,
    );
  }
}
