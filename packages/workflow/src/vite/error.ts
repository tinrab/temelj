/** Error thrown for transform failures. */
export class WorkflowTransformError extends Error {
  constructor(message: string, context?: Function) {
    super(message);
    this.name = "WorkflowTransformError";

    if (Error.captureStackTrace !== undefined) {
      Error.captureStackTrace(this, context ?? this.constructor);
    }
  }

  static directiveParametersMustBeIdentifiers(this: void): never {
    throw new WorkflowTransformError(
      "Workflow directive parameters must be identifiers",
      WorkflowTransformError.directiveParametersMustBeIdentifiers,
    );
  }

  static metadataMissing(this: void, name: string): never {
    throw new WorkflowTransformError(
      `Workflow metadata was not collected for ${name}`,
      WorkflowTransformError.metadataMissing,
    );
  }

  static directiveFunctionMustBeNamed(this: void): never {
    throw new WorkflowTransformError(
      "Directive function declarations must be named",
      WorkflowTransformError.directiveFunctionMustBeNamed,
    );
  }

  static directiveFunctionCannotBeGenerator(this: void, directive: string, name: string): never {
    throw new WorkflowTransformError(
      `"${directive}" function ${name} cannot be a generator`,
      WorkflowTransformError.directiveFunctionCannotBeGenerator,
    );
  }

  static workflowFunctionMustBeAsync(this: void, name: string): never {
    throw new WorkflowTransformError(
      `"use workflow" function ${name} must be async`,
      WorkflowTransformError.workflowFunctionMustBeAsync,
    );
  }

  static directivesMustBeTopLevel(this: void): never {
    throw new WorkflowTransformError(
      "Workflow directives are only supported on top-level functions",
      WorkflowTransformError.directivesMustBeTopLevel,
    );
  }

  static directiveImportsMustBeNamed(this: void, specifier: string): never {
    throw new WorkflowTransformError(
      `Workflow directive imports from ${specifier} must use named imports`,
      WorkflowTransformError.directiveImportsMustBeNamed,
    );
  }

  static directiveReExportsMustBeNamed(this: void, specifier: string): never {
    throw new WorkflowTransformError(
      `Workflow directive re-exports from ${specifier} must use named exports`,
      WorkflowTransformError.directiveReExportsMustBeNamed,
    );
  }

  static nondeterministicGlobal(
    this: void,
    workflowName: string,
    globalName: string,
    line: number,
    character: number,
  ): never {
    throw new WorkflowTransformError(
      `"use workflow" function ${workflowName} uses nondeterministic global ${globalName} ` +
        `at ${line}:${character}; use deterministic workflow helpers or durable steps`,
      WorkflowTransformError.nondeterministicGlobal,
    );
  }

  static invalidSourceReplacementRange(this: void, start: number, end: number): never {
    throw new WorkflowTransformError(
      `Invalid source replacement range: ${start}..${end}`,
      WorkflowTransformError.invalidSourceReplacementRange,
    );
  }

  static invalidSourceReadRange(this: void, start: number, end: number): never {
    throw new WorkflowTransformError(
      `Invalid source read range: ${start}..${end}`,
      WorkflowTransformError.invalidSourceReadRange,
    );
  }

  static overlappingSourceReplacementRanges(
    this: void,
    currentStart: number,
    currentEnd: number,
    previousStart: number,
    previousEnd: number,
  ): never {
    throw new WorkflowTransformError(
      `Overlapping source replacement ranges: ${currentStart}..${currentEnd} and ${previousStart}..${previousEnd}`,
      WorkflowTransformError.overlappingSourceReplacementRanges,
    );
  }
}
