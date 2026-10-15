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
  | Readonly<{ kind: "streamCompleted" }>
  | Readonly<{ kind: "codeBlockMetadata"; messages: readonly string[] }>;

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
  ): never {
    throw new InputError(
      `Cannot format ${nodeKind} as TeX because its value contains ${JSON.stringify(delimiter)}`,
      { kind: "mathDelimiterCollision", format: "tex", nodeKind, delimiter },
      InputError.mathDelimiterCollision,
    );
  }

  public static mathMetadataUnsupported(this: void): never {
    throw new InputError(
      "TeX display math does not support fence metadata",
      { kind: "mathMetadata", format: "tex" },
      InputError.mathMetadataUnsupported,
    );
  }

  public static invalidHtmlTagName(this: void, name: string): never {
    throw new InputError(
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
  ): never {
    throw new InputError(
      `Replacement range ${start}..${end} is outside source of length ${sourceLength}`,
      { kind: "replacementRange", start, end, sourceLength },
      InputError.replacementRangeOutsideSource,
    );
  }

  public static sourceOffsetOutsideFile(this: void, offset: number, sourceLength: number): never {
    throw new InputError(
      `Source offset ${offset} is outside file of length ${sourceLength}`,
      { kind: "sourceOffset", offset, sourceLength },
      InputError.sourceOffsetOutsideFile,
    );
  }

  public static invalidCodeBlockMetadata(this: void, messages: readonly string[]): never {
    throw new InputError(
      `Invalid code block metadata: ${messages.join("; ")}`,
      { kind: "codeBlockMetadata", messages },
      InputError.invalidCodeBlockMetadata,
    );
  }

  public static streamCompleted(this: void): never {
    throw new InputError(
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

  public static asynchronousPluginInSynchronousProcessor(this: void): never {
    throw new ConfigurationError(
      "processSync() cannot run an asynchronous plugin; use process() instead",
      { kind: "asynchronousPluginInSynchronousProcessor" },
      ConfigurationError.asynchronousPluginInSynchronousProcessor,
    );
  }

  public static unsupportedUnifiedPlugin(this: void): never {
    throw new ConfigurationError(
      "Unified parser and compiler plugins are not supported by the transform adapter",
      { kind: "unifiedPlugin" },
      ConfigurationError.unsupportedUnifiedPlugin,
    );
  }

  public static invalidCacheCapacity(this: void, pluginName: string, capacity: number): never {
    throw new ConfigurationError(
      `Invalid ${pluginName} cache capacity: ${capacity}; expected a non-negative safe integer`,
      { kind: "cacheCapacity", pluginName, capacity },
      ConfigurationError.invalidCacheCapacity,
    );
  }

  public static invalidCompilerLimit(this: void, option: string, value: number): never {
    throw new ConfigurationError(
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
  ): never {
    throw new ConfigurationError(
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
  ): never {
    throw new ConfigurationError(
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
  ): never {
    throw new ConfigurationError(
      `Invalid ${pluginName} ${option}: ${value}; expected a safe integer of at least ${minimum}`,
      { kind: "pluginIntegerOption", pluginName, option, value, minimum },
      ConfigurationError.invalidPluginIntegerOption,
    );
  }
}

export type TransformTarget = "document" | "html";

export type TransformIssue = Readonly<{
  kind: "threw";
  target: TransformTarget;
  pluginName: string;
}>;

export class TransformError extends MdxError {
  public readonly issue: TransformIssue;

  private constructor(
    message: string,
    issue: TransformIssue,
    options: ErrorOptions,
    context: Function,
  ) {
    super("TransformError", message, options, context);
    this.issue = Object.freeze(issue);
  }

  public static pluginTransformFailed(
    this: void,
    target: TransformTarget,
    pluginName: string,
    cause: unknown,
  ): never {
    throw new TransformError(
      `Plugin "${pluginName}" failed while transforming ${target}`,
      { kind: "threw", target, pluginName },
      { cause },
      TransformError.pluginTransformFailed,
    );
  }
}

export type CompilationInvariant =
  | "defaultExportBindingMissing"
  | "defaultExportDeclarationMissing"
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
  | Readonly<{ kind: "generatedCodeLimit"; actualBytes: number; maximumBytes: number }>
  | Readonly<{ kind: "generatedProgram" }>
  | Readonly<{ kind: "invalidDocument"; invariant: CompilationInvariant; detail?: string }>
  | Readonly<{ kind: "sourceMapLimit"; actualBytes: number; maximumBytes: number }>;

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

  public static generationFailed(this: void, cause: unknown): never {
    throw new CompileError(
      "MDX compilation failed",
      { kind: "generation" },
      { cause },
      CompileError.generationFailed,
    );
  }

  public static multipleDefaultExports(this: void): never {
    CompileError.invalidDocument(
      "multipleDefaultExports",
      "MDX has more than one default export",
      undefined,
      CompileError.multipleDefaultExports,
    );
  }

  public static defaultExportDeclarationMissing(this: void): never {
    CompileError.invalidDocument(
      "defaultExportDeclarationMissing",
      "Default MDX export has no declaration",
      undefined,
      CompileError.defaultExportDeclarationMissing,
    );
  }

  public static defaultExportBindingMissing(this: void): never {
    CompileError.invalidDocument(
      "defaultExportBindingMissing",
      "Default MDX export has no local binding",
      undefined,
      CompileError.defaultExportBindingMissing,
    );
  }

  public static jsxElementOpeningMissing(this: void): never {
    CompileError.invalidDocument(
      "jsxElementOpeningMissing",
      "JSX element has no opening element",
      undefined,
      CompileError.jsxElementOpeningMissing,
    );
  }

  public static jsxElementNameMissing(this: void): never {
    CompileError.invalidDocument(
      "jsxElementNameMissing",
      "JSX element has no name",
      undefined,
      CompileError.jsxElementNameMissing,
    );
  }

  public static jsxSpreadArgumentMissing(this: void): never {
    CompileError.invalidDocument(
      "jsxSpreadArgumentMissing",
      "JSX spread has no argument",
      undefined,
      CompileError.jsxSpreadArgumentMissing,
    );
  }

  public static jsxAttributeNameMissing(this: void): never {
    CompileError.invalidDocument(
      "jsxAttributeNameMissing",
      "JSX attribute has no name",
      undefined,
      CompileError.jsxAttributeNameMissing,
    );
  }

  public static jsxAttributeExpressionEmpty(this: void): never {
    CompileError.invalidDocument(
      "jsxAttributeExpressionEmpty",
      "JSX attribute expression is empty",
      undefined,
      CompileError.jsxAttributeExpressionEmpty,
    );
  }

  public static jsxIdentifierNameMissing(this: void): never {
    CompileError.invalidDocument(
      "jsxIdentifierNameMissing",
      "JSX identifier has no name",
      undefined,
      CompileError.jsxIdentifierNameMissing,
    );
  }

  public static jsxMemberExpressionIncomplete(this: void): never {
    CompileError.invalidDocument(
      "jsxMemberExpressionIncomplete",
      "JSX member expression is incomplete",
      undefined,
      CompileError.jsxMemberExpressionIncomplete,
    );
  }

  public static jsxNamespaceIncomplete(this: void): never {
    CompileError.invalidDocument(
      "jsxNamespaceIncomplete",
      "JSX namespace is incomplete",
      undefined,
      CompileError.jsxNamespaceIncomplete,
    );
  }

  public static unsupportedJsxName(this: void, nodeType: string): never {
    CompileError.invalidDocument(
      "unsupportedJsxName",
      `Unsupported JSX name node: ${nodeType}`,
      nodeType,
      CompileError.unsupportedJsxName,
    );
  }

  public static generatedCodeLimitExceeded(
    this: void,
    actualBytes: number,
    maximumBytes: number,
  ): never {
    throw new CompileError(
      `Generated MDX code is ${actualBytes} bytes; configured maximum is ${maximumBytes} bytes`,
      { kind: "generatedCodeLimit", actualBytes, maximumBytes },
      {},
      CompileError.generatedCodeLimitExceeded,
    );
  }

  public static generatedProgramInvalid(this: void, cause: unknown): never {
    throw new CompileError(
      "The generated MDX module is not valid JavaScript",
      { kind: "generatedProgram" },
      { cause },
      CompileError.generatedProgramInvalid,
    );
  }

  public static sourceMapLimitExceeded(
    this: void,
    actualBytes: number,
    maximumBytes: number,
  ): never {
    throw new CompileError(
      `Generated MDX source map is ${actualBytes} bytes; configured maximum is ${maximumBytes} bytes`,
      { kind: "sourceMapLimit", actualBytes, maximumBytes },
      {},
      CompileError.sourceMapLimitExceeded,
    );
  }

  private static invalidDocument(
    invariant: CompilationInvariant,
    message: string,
    detail: string | undefined,
    context: Function,
  ): never {
    throw new CompileError(
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
