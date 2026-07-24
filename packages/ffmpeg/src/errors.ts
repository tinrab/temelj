export class FFmpegDefinitionError extends Error {
  constructor(message: string, context?: Function) {
    super(message);
    this.name = "FFmpegDefinitionError";

    if (Error.captureStackTrace !== undefined) {
      Error.captureStackTrace(this, context ?? this.constructor);
    }
  }

  static nonEmpty(this: void, label: string): never {
    throw new FFmpegDefinitionError(`${label} cannot be empty`, FFmpegDefinitionError.nonEmpty);
  }

  static programStreamsRequired(this: void): never {
    throw new FFmpegDefinitionError(
      "Program definition must include at least one stream",
      FFmpegDefinitionError.programStreamsRequired,
    );
  }

  static streamGroupInputMappingIncomplete(this: void): never {
    throw new FFmpegDefinitionError(
      "Stream group input mapping requires both inputFileId and inputGroupId",
      FFmpegDefinitionError.streamGroupInputMappingIncomplete,
    );
  }

  static dispositionDefinitionEmpty(this: void): never {
    throw new FFmpegDefinitionError(
      "Disposition definition must include clear, set, add, or remove",
      FFmpegDefinitionError.dispositionDefinitionEmpty,
    );
  }

  static emptyFilterGraphChain(this: void): never {
    throw new FFmpegDefinitionError(
      "Cannot label an empty filter graph chain",
      FFmpegDefinitionError.emptyFilterGraphChain,
    );
  }

  static duplicateFilterGraphOutputLabel(this: void, label: string): never {
    throw new FFmpegDefinitionError(
      `Duplicate filter graph output label "${label}"`,
      FFmpegDefinitionError.duplicateFilterGraphOutputLabel,
    );
  }

  static inputMissing(this: void): never {
    throw new FFmpegDefinitionError(
      "No input defined. Call .input(...) before mutating input options.",
      FFmpegDefinitionError.inputMissing,
    );
  }

  static outputMissing(this: void): never {
    throw new FFmpegDefinitionError(
      "No output defined. Call .output(...) before mutating output options.",
      FFmpegDefinitionError.outputMissing,
    );
  }

  static buildOutputMissing(this: void): never {
    throw new FFmpegDefinitionError(
      "No output defined. Call .output(...) before build().",
      FFmpegDefinitionError.buildOutputMissing,
    );
  }

  static mappedFilterLabelMissing(this: void, label: string): never {
    throw new FFmpegDefinitionError(
      `Mapped filter label "${label}" is not defined in the current filter graph`,
      FFmpegDefinitionError.mappedFilterLabelMissing,
    );
  }
}
