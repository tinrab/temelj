import { WorkflowErrorCode } from "../types/error-code.ts";
import { WorkflowError } from "./base.ts";

/** Error thrown for definition failures. */
export class WorkflowDefinitionError extends WorkflowError {
  constructor(message: string, context?: Function) {
    super(message, { code: WorkflowErrorCode.DEFINITION_INVALID }, context);
    this.name = "WorkflowDefinitionError";
  }

  static create(this: void, message: string): WorkflowDefinitionError {
    return new WorkflowDefinitionError(message, WorkflowDefinitionError.create);
  }

  static object(this: void, label: string): never {
    throw new WorkflowDefinitionError(`${label} must be an object`, WorkflowDefinitionError.object);
  }

  static standardObject(this: void, label: string): never {
    throw new WorkflowDefinitionError(
      `${label}.~standard must be an object`,
      WorkflowDefinitionError.standardObject,
    );
  }

  static standardValidateFunction(this: void, label: string): never {
    throw new WorkflowDefinitionError(
      `${label}.~standard.validate must be a function`,
      WorkflowDefinitionError.standardValidateFunction,
    );
  }

  static handlerFunction(this: void): never {
    throw new WorkflowDefinitionError(
      "Workflow handler must be a function",
      WorkflowDefinitionError.handlerFunction,
    );
  }

  static stepNameOrCommandIdRequired(this: void): never {
    throw new WorkflowDefinitionError(
      "Workflow step name or commandId is required",
      WorkflowDefinitionError.stepNameOrCommandIdRequired,
    );
  }

  static string(this: void, label: string): never {
    throw new WorkflowDefinitionError(`${label} must be a string`, WorkflowDefinitionError.string);
  }

  static nonEmpty(this: void, label: string): never {
    throw new WorkflowDefinitionError(
      `${label} must not be empty`,
      WorkflowDefinitionError.nonEmpty,
    );
  }

  static nameMismatch(this: void, label: string): never {
    throw new WorkflowDefinitionError(
      `${label} name mismatch`,
      WorkflowDefinitionError.nameMismatch,
    );
  }

  static versionMismatch(this: void, label: string): never {
    throw new WorkflowDefinitionError(
      `${label} version mismatch`,
      WorkflowDefinitionError.versionMismatch,
    );
  }

  static compiledMetadataMissing(this: void): never {
    throw new WorkflowDefinitionError(
      "Compiled workflow function is missing compiled workflow metadata",
      WorkflowDefinitionError.compiledMetadataMissing,
    );
  }

  static compiledStepMetadataMissing(this: void): never {
    throw new WorkflowDefinitionError(
      "Compiled workflow step function is missing compiled workflow metadata",
      WorkflowDefinitionError.compiledStepMetadataMissing,
    );
  }

  static implementationAlreadyRegistered(this: void, key: string): never {
    throw new WorkflowDefinitionError(
      `Workflow implementation already registered: ${key}`,
      WorkflowDefinitionError.implementationAlreadyRegistered,
    );
  }
}
