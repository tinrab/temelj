import type { StandardSchemaV1 } from "@standard-schema/spec";

export type Schema<TInput = unknown, TOutput = TInput> = StandardSchemaV1<TInput, TOutput>;

export type SchemaOutput<TSchema extends Schema> = StandardSchemaV1.InferOutput<TSchema>;

export type SchemaResult<TOutput> = StandardSchemaV1.Result<TOutput>;

export type SchemaIssue = StandardSchemaV1.Issue;

export type SchemaValidator<TOutput> = (value: unknown) => SchemaResult<TOutput>;

export type SchemaShape = Record<string, Schema>;

export type ObjectOutput<TShape extends SchemaShape> = {
  readonly [TKey in keyof TShape]: SchemaOutput<TShape[TKey]>;
};

export function schema<TInput, TOutput>(
  validate: SchemaValidator<TOutput>,
): Schema<TInput, TOutput> {
  return {
    "~standard": {
      version: 1,
      vendor: "@temelj/standard-schema",
      validate,
    },
  };
}

export function success<T>(value: T): StandardSchemaV1.SuccessResult<T> {
  return { value };
}

export function failure(
  message: string,
  path?: ReadonlyArray<PropertyKey>,
): StandardSchemaV1.FailureResult {
  return {
    issues: [
      {
        message,
        ...(path === undefined ? {} : { path }),
      },
    ],
  };
}

export class StandardSchemaValidationError extends Error {
  public readonly issues: ReadonlyArray<SchemaIssue>;

  constructor(message: string, issues: ReadonlyArray<SchemaIssue>) {
    super(message);
    this.name = "StandardSchemaValidationError";
    this.issues = issues;
  }
}

export async function validateStandardSchema<TSchema extends Schema>(
  inputSchema: TSchema,
  value: unknown,
  message = "Schema validation failed",
): Promise<SchemaOutput<TSchema>> {
  const result = await inputSchema["~standard"].validate(value);
  if (!result.issues) {
    return result.value as SchemaOutput<TSchema>;
  }
  throw new StandardSchemaValidationError(message, result.issues);
}

export function validateStandardSchemaSync<TSchema extends Schema>(
  inputSchema: TSchema,
  value: unknown,
  message = "Schema validation failed",
): SchemaOutput<TSchema> {
  const result = inputSchema["~standard"].validate(value);
  ensureSynchronous(result);
  if (!result.issues) {
    return result.value as SchemaOutput<TSchema>;
  }
  throw new StandardSchemaValidationError(message, result.issues);
}

export function unknown(): Schema<unknown> {
  return schema((value) => success(value));
}

export function string(message = "Expected a string"): Schema<unknown, string> {
  return schema((value) => (typeof value === "string" ? success(value) : failure(message)));
}

export function number(message = "Expected a number"): Schema<unknown, number> {
  return schema((value) => (typeof value === "number" ? success(value) : failure(message)));
}

export function boolean(message = "Expected a boolean"): Schema<unknown, boolean> {
  return schema((value) => (typeof value === "boolean" ? success(value) : failure(message)));
}

export function literal<const TValue extends string | number | boolean | null | undefined>(
  expected: TValue,
  message = `Expected ${String(expected)}`,
): Schema<unknown, TValue> {
  return schema((value) => (Object.is(value, expected) ? success(expected) : failure(message)));
}

export function picklist<const TValues extends readonly [unknown, ...unknown[]]>(
  values: TValues,
  message = `Expected one of ${values.map(String).join(", ")}`,
): Schema<unknown, TValues[number]> {
  return schema((value) =>
    values.some((item) => Object.is(item, value))
      ? success(value as TValues[number])
      : failure(message),
  );
}

export function union<const TSchemas extends readonly [Schema, ...Schema[]]>(
  schemas: TSchemas,
  message = "Expected a union match",
): Schema<unknown, SchemaOutput<TSchemas[number]>> {
  return schema((value) => {
    const issues: SchemaIssue[] = [];

    for (const itemSchema of schemas) {
      const result:
        | SchemaResult<SchemaOutput<TSchemas[number]>>
        | Promise<SchemaResult<SchemaOutput<TSchemas[number]>>> =
        itemSchema["~standard"].validate(value);
      ensureSynchronous(result);
      if (!result.issues) {
        return success(result.value as SchemaOutput<TSchemas[number]>);
      }
      issues.push(...result.issues);
    }

    return issues.length > 0 ? failure(message) : failure(message);
  });
}

export function array<TItem extends Schema = Schema<unknown>>(
  itemSchema?: TItem,
  message = "Expected an array",
): Schema<unknown, SchemaOutput<TItem>[]> {
  return schema((value) => {
    if (!Array.isArray(value)) {
      return failure(message);
    }

    if (itemSchema === undefined) {
      return success(value as SchemaOutput<TItem>[]);
    }

    const output: SchemaOutput<TItem>[] = [];
    const issues: SchemaIssue[] = [];
    for (let index = 0; index < value.length; index++) {
      const result: SchemaResult<SchemaOutput<TItem>> | Promise<SchemaResult<SchemaOutput<TItem>>> =
        itemSchema["~standard"].validate(value[index]);
      ensureSynchronous(result);
      if (result.issues) {
        issues.push(...result.issues.map((issue: SchemaIssue) => withPath(index, issue)));
      } else {
        output.push(result.value as SchemaOutput<TItem>);
      }
    }

    return issues.length > 0 ? { issues } : success(output);
  });
}

export function object<TShape extends SchemaShape>(
  shape: TShape,
  message = "Expected an object",
): Schema<unknown, ObjectOutput<TShape>> {
  return schema((value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return failure(message);
    }

    const input = value as Record<string, unknown>;
    const output: Partial<ObjectOutput<TShape>> = {};
    const issues: SchemaIssue[] = [];

    for (const key of Object.keys(shape) as Array<keyof TShape & string>) {
      const result:
        | SchemaResult<SchemaOutput<TShape[typeof key]>>
        | Promise<SchemaResult<SchemaOutput<TShape[typeof key]>>> = shape[key][
        "~standard"
      ].validate(input[key]);
      ensureSynchronous(result);
      if (result.issues) {
        issues.push(...result.issues.map((issue: SchemaIssue) => withPath(key, issue)));
      } else {
        output[key] = result.value as ObjectOutput<TShape>[typeof key];
      }
    }

    return issues.length > 0 ? { issues } : success(output as ObjectOutput<TShape>);
  });
}

export function record<TValue extends Schema>(
  valueSchema: TValue,
  message = "Expected an object",
): Schema<unknown, Record<string, SchemaOutput<TValue>>> {
  return schema((value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return failure(message);
    }

    const output: Record<string, SchemaOutput<TValue>> = {};
    const issues: SchemaIssue[] = [];
    for (const [key, item] of Object.entries(value)) {
      const result:
        | SchemaResult<SchemaOutput<TValue>>
        | Promise<SchemaResult<SchemaOutput<TValue>>> = valueSchema["~standard"].validate(item);
      ensureSynchronous(result);
      if (result.issues) {
        issues.push(...result.issues.map((issue: SchemaIssue) => withPath(key, issue)));
      } else {
        output[key] = result.value as SchemaOutput<TValue>;
      }
    }

    return issues.length > 0 ? { issues } : success(output);
  });
}

export function optional<TSchema extends Schema>(
  inner: TSchema,
): Schema<unknown, SchemaOutput<TSchema> | undefined> {
  return schema((value) => {
    if (value === undefined) {
      return success(undefined);
    }

    const result = inner["~standard"].validate(value);
    ensureSynchronous(result);
    return result;
  });
}

export function defaulted<TSchema extends Schema>(
  inner: TSchema,
  defaultValue: SchemaOutput<TSchema> | (() => SchemaOutput<TSchema>),
): Schema<unknown, SchemaOutput<TSchema>> {
  return schema((value) => {
    if (value === undefined) {
      return success(
        typeof defaultValue === "function"
          ? (defaultValue as () => SchemaOutput<TSchema>)()
          : defaultValue,
      );
    }

    const result = inner["~standard"].validate(value);
    ensureSynchronous(result);
    return result;
  });
}

function ensureSynchronous<T>(value: T | Promise<T>): asserts value is T {
  if (value instanceof Promise) {
    throw new Error("Async schema validation is not supported");
  }
}

function withPath(key: PropertyKey, issue: SchemaIssue): SchemaIssue {
  return {
    ...issue,
    path: [key, ...(issue.path ?? [])],
  };
}

export const ss = {
  schema,
  success,
  failure,
  StandardSchemaValidationError,
  validateStandardSchema,
  validateStandardSchemaSync,
  unknown,
  string,
  number,
  boolean,
  literal,
  picklist,
  union,
  array,
  object,
  record,
  optional,
  defaulted,
};
