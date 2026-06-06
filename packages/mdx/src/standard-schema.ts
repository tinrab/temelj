import type { StandardSchemaV1 } from "@standard-schema/spec";

export class StandardSchemaValidationError extends Error {
  public readonly issues: ReadonlyArray<StandardSchemaV1.Issue>;

  constructor(message: string, issues: ReadonlyArray<StandardSchemaV1.Issue>) {
    super(message);
    this.name = "StandardSchemaValidationError";
    this.issues = issues;
  }
}

export async function validateStandardSchema<TSchema extends StandardSchemaV1>(
  schema: TSchema,
  value: unknown,
  message = "Schema validation failed",
): Promise<StandardSchemaV1.InferOutput<TSchema>> {
  const result = await schema["~standard"].validate(value);
  if (!result.issues) {
    return result.value as StandardSchemaV1.InferOutput<TSchema>;
  }
  throw new StandardSchemaValidationError(message, result.issues);
}

export function validateStandardSchemaSync<TSchema extends StandardSchemaV1>(
  schema: TSchema,
  value: unknown,
  message = "Schema validation failed",
): StandardSchemaV1.InferOutput<TSchema> {
  const result = schema["~standard"].validate(value);
  if (result instanceof Promise) {
    throw new Error("Async schema validation is not supported");
  }
  if (!result.issues) {
    return result.value as StandardSchemaV1.InferOutput<TSchema>;
  }
  throw new StandardSchemaValidationError(message, result.issues);
}
