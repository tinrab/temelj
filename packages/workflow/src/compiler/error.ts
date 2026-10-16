export class WorkflowTransformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowTransformError";
  }

  static directiveParametersMustBeIdentifiers(this: void): never {
    throw new WorkflowTransformError("Workflow directive parameters must be identifiers");
  }

  static metadataMissing(this: void, name: string): never {
    throw new WorkflowTransformError(`Workflow metadata was not collected for ${name}`);
  }

  static directiveFunctionMustBeNamed(this: void): never {
    throw new WorkflowTransformError("Directive function declarations must be named");
  }

  static directiveFunctionCannotBeGenerator(this: void, directive: string, name: string): never {
    throw new WorkflowTransformError(`"${directive}" function ${name} cannot be a generator`);
  }

  static workflowFunctionMustBeAsync(this: void, name: string): never {
    throw new WorkflowTransformError(`"use workflow" function ${name} must be async`);
  }

  static directivesMustBeTopLevel(this: void): never {
    throw new WorkflowTransformError(
      "Workflow directives are only supported on top-level functions",
    );
  }

  static directiveImportsMustBeNamed(this: void, specifier: string): never {
    throw new WorkflowTransformError(
      `Workflow directive imports from ${specifier} must use named imports`,
    );
  }

  static directiveReExportsMustBeNamed(this: void, specifier: string): never {
    throw new WorkflowTransformError(
      `Workflow directive re-exports from ${specifier} must use named exports`,
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
    );
  }

  static invalidSourceReplacementRange(this: void, start: number, end: number): never {
    throw new WorkflowTransformError(`Invalid source replacement range: ${start}..${end}`);
  }

  static invalidSourceReadRange(this: void, start: number, end: number): never {
    throw new WorkflowTransformError(`Invalid source read range: ${start}..${end}`);
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
    );
  }
}
