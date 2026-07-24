import type { StandardSchemaV1 } from "@standard-schema/spec";

export type Schema<TInput = unknown, TOutput = TInput> = StandardSchemaV1<TInput, TOutput>;

export type SchemaInput<TSchema extends Schema> = StandardSchemaV1.InferInput<TSchema>;

export type SchemaOutput<TSchema extends Schema> = StandardSchemaV1.InferOutput<TSchema>;

export type SchemaResult<TOutput> = StandardSchemaV1.Result<TOutput>;

export type SchemaIssue = StandardSchemaV1.Issue;

export type SchemaValidator<TOutput> = (value: unknown) => SchemaResult<TOutput>;

export type SchemaShape = Record<string, Schema>;

export type ObjectOutput<TShape extends SchemaShape> = {
  readonly [TKey in keyof TShape]: SchemaOutput<TShape[TKey]>;
};

export type ObjectInput<TShape extends SchemaShape> = {
  readonly [TKey in keyof TShape]: SchemaInput<TShape[TKey]>;
};

export type SafeParseResult<T> =
  | { readonly success: true; readonly value: T }
  | { readonly success: false; readonly issues: ReadonlyArray<SchemaIssue> };

export interface ObjectOptions {
  readonly unknownKeys?: "strip" | "passthrough" | "strict";
}

interface Constructor<T> extends Function {
  readonly prototype: T;
  readonly name: string;
}

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

  constructor(message: string, issues: ReadonlyArray<SchemaIssue>, context?: Function) {
    super(message);
    this.name = "StandardSchemaValidationError";
    this.issues = issues;

    if (Error.captureStackTrace !== undefined) {
      Error.captureStackTrace(this, context ?? this.constructor);
    }
  }

  static failed(this: void, message: string, issues: ReadonlyArray<SchemaIssue>): never {
    throw new StandardSchemaValidationError(message, issues, StandardSchemaValidationError.failed);
  }
}

export class StandardSchemaAsyncValidationError extends Error {
  constructor(message: string, context?: Function) {
    super(message);
    this.name = "StandardSchemaAsyncValidationError";

    if (Error.captureStackTrace !== undefined) {
      Error.captureStackTrace(this, context ?? this.constructor);
    }
  }

  static unsupported(this: void): never {
    throw new StandardSchemaAsyncValidationError(
      "Async schema validation is not supported",
      StandardSchemaAsyncValidationError.unsupported,
    );
  }
}

export async function validateStandardSchema<TSchema extends Schema>(
  inputSchema: TSchema,
  value: unknown,
  message: string = "Schema validation failed",
): Promise<SchemaOutput<TSchema>> {
  const result = await inputSchema["~standard"].validate(value);
  if (!result.issues) {
    return result.value as SchemaOutput<TSchema>;
  }
  StandardSchemaValidationError.failed(message, result.issues);
}

export function validateStandardSchemaSync<TSchema extends Schema>(
  inputSchema: TSchema,
  value: unknown,
  message: string = "Schema validation failed",
): SchemaOutput<TSchema> {
  const result = inputSchema["~standard"].validate(value);
  ensureSynchronous(result);
  if (!result.issues) {
    return result.value as SchemaOutput<TSchema>;
  }
  StandardSchemaValidationError.failed(message, result.issues);
}

export async function safeParse<TSchema extends Schema>(
  inputSchema: TSchema,
  value: SchemaInput<TSchema>,
): Promise<SafeParseResult<SchemaOutput<TSchema>>> {
  const result = await inputSchema["~standard"].validate(value);
  return result.issues
    ? { success: false, issues: result.issues }
    : { success: true, value: result.value as SchemaOutput<TSchema> };
}

export function safeParseSync<TSchema extends Schema>(
  inputSchema: TSchema,
  value: SchemaInput<TSchema>,
): SafeParseResult<SchemaOutput<TSchema>> {
  const result = inputSchema["~standard"].validate(value);
  ensureSynchronous(result);
  return result.issues
    ? { success: false, issues: result.issues }
    : { success: true, value: result.value as SchemaOutput<TSchema> };
}

export async function parse<TSchema extends Schema>(
  inputSchema: TSchema,
  value: SchemaInput<TSchema>,
  message?: string,
): Promise<SchemaOutput<TSchema>> {
  return await validateStandardSchema(inputSchema, value, message);
}

export function parseSync<TSchema extends Schema>(
  inputSchema: TSchema,
  value: SchemaInput<TSchema>,
  message?: string,
): SchemaOutput<TSchema> {
  return validateStandardSchemaSync(inputSchema, value, message);
}

export function unknown(): Schema<unknown> {
  return schema((value) => success(value));
}

export function string(message: string = "Expected a string"): Schema<unknown, string> {
  return schema((value) => (typeof value === "string" ? success(value) : failure(message)));
}

export function number(message: string = "Expected a number"): Schema<unknown, number> {
  return schema((value) => (typeof value === "number" ? success(value) : failure(message)));
}

export function finite(message: string = "Expected a finite number"): Schema<unknown, number> {
  return refine(number(), Number.isFinite, message);
}

export function integer(message: string = "Expected an integer"): Schema<unknown, number> {
  return refine(number(), Number.isInteger, message);
}

export function safeInteger(message: string = "Expected a safe integer"): Schema<unknown, number> {
  return refine(number(), Number.isSafeInteger, message);
}

export function positiveNumber(
  message: string = "Expected a positive number",
): Schema<unknown, number> {
  return refine(number(), (value) => Number.isFinite(value) && value > 0, message);
}

export function nonNegativeNumber(
  message: string = "Expected a non-negative number",
): Schema<unknown, number> {
  return refine(number(), (value) => Number.isFinite(value) && value >= 0, message);
}

export function positiveSafeInteger(
  message: string = "Expected a positive safe integer",
): Schema<unknown, number> {
  return refine(number(), (value) => Number.isSafeInteger(value) && value > 0, message);
}

export function nonNegativeSafeInteger(
  message: string = "Expected a non-negative safe integer",
): Schema<unknown, number> {
  return refine(number(), (value) => Number.isSafeInteger(value) && value >= 0, message);
}

export function min(
  inner: Schema<unknown, number>,
  minimum: number,
  message: string = `Expected a number greater than or equal to ${minimum}`,
): Schema<unknown, number> {
  return refine(inner, (value) => value >= minimum, message);
}

export function max(
  inner: Schema<unknown, number>,
  maximum: number,
  message: string = `Expected a number less than or equal to ${maximum}`,
): Schema<unknown, number> {
  return refine(inner, (value) => value <= maximum, message);
}

export function nonEmptyString(
  message: string = "Expected a non-empty string",
): Schema<unknown, string> {
  return refine(string(), (value) => value.length > 0, message);
}

export function nonBlankString(
  message: string = "Expected a non-blank string",
): Schema<unknown, string> {
  return refine(string(), (value) => value.trim().length > 0, message);
}

export function boolean(message: string = "Expected a boolean"): Schema<unknown, boolean> {
  return schema((value) => (typeof value === "boolean" ? success(value) : failure(message)));
}

export function fn(
  message: string = "Expected a function",
): Schema<unknown, (...args: readonly unknown[]) => unknown> {
  return schema((value) =>
    typeof value === "function"
      ? success(value as (...args: readonly unknown[]) => unknown)
      : failure(message),
  );
}

export function instanceOf<T>(
  constructor: Constructor<T>,
  message: string = `Expected ${constructor.name}`,
): Schema<unknown, T> {
  return schema((value) => (value instanceof constructor ? success(value) : failure(message)));
}

export function literal<const TValue extends string | number | boolean | null | undefined>(
  expected: TValue,
  message: string = `Expected ${String(expected)}`,
): Schema<unknown, TValue> {
  return schema((value) => (Object.is(value, expected) ? success(expected) : failure(message)));
}

export function picklist<const TValues extends readonly [unknown, ...unknown[]]>(
  values: TValues,
  message: string = `Expected one of ${values.map(String).join(", ")}`,
): Schema<unknown, TValues[number]> {
  return schema((value) =>
    values.some((item) => Object.is(item, value))
      ? success(value as TValues[number])
      : failure(message),
  );
}

export function union<const TSchemas extends readonly [Schema, ...Schema[]]>(
  schemas: TSchemas,
  message: string = "Expected a union match",
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
  message: string = "Expected an array",
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
  message: string = "Expected an object",
  options: ObjectOptions = {},
): Schema<unknown, ObjectOutput<TShape>> {
  return schema((value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return failure(message);
    }

    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> =
      options.unknownKeys === "passthrough" ? { ...input } : {};
    const issues: SchemaIssue[] = [];
    const shapeKeys = Object.keys(shape);

    if (options.unknownKeys === "strict") {
      for (const key of Object.keys(input)) {
        if (!shapeKeys.includes(key)) {
          issues.push({ message: "Unexpected key", path: [key] });
        }
      }
    }

    for (const key of shapeKeys as Array<keyof TShape & string>) {
      const result:
        | SchemaResult<SchemaOutput<TShape[typeof key]>>
        | Promise<SchemaResult<SchemaOutput<TShape[typeof key]>>> = shape[key][
        "~standard"
      ].validate(input[key]);
      ensureSynchronous(result);
      if (result.issues) {
        issues.push(...result.issues.map((issue: SchemaIssue) => withPath(key, issue)));
      } else if (key in input || result.value !== undefined) {
        output[key] = result.value as ObjectOutput<TShape>[typeof key];
      }
    }

    return issues.length > 0 ? { issues } : success(output as ObjectOutput<TShape>);
  });
}

export function strictObject<TShape extends SchemaShape>(
  shape: TShape,
  message: string = "Expected an object",
): Schema<unknown, ObjectOutput<TShape>> {
  return object(shape, message, { unknownKeys: "strict" });
}

export function looseObject<TShape extends SchemaShape>(
  shape: TShape,
  message: string = "Expected an object",
): Schema<unknown, ObjectOutput<TShape> & Record<string, unknown>> {
  return object(shape, message, { unknownKeys: "passthrough" }) as Schema<
    unknown,
    ObjectOutput<TShape> & Record<string, unknown>
  >;
}

export function record<TValue extends Schema>(
  valueSchema: TValue,
  message: string = "Expected an object",
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

export function refine<TSchema extends Schema, TOutput extends SchemaOutput<TSchema>>(
  inner: TSchema,
  predicate: (value: SchemaOutput<TSchema>) => value is TOutput,
  message?: string,
): Schema<SchemaInput<TSchema>, TOutput>;
export function refine<TSchema extends Schema>(
  inner: TSchema,
  predicate: (value: SchemaOutput<TSchema>) => boolean,
  message?: string,
): Schema<SchemaInput<TSchema>, SchemaOutput<TSchema>>;
export function refine<TSchema extends Schema>(
  inner: TSchema,
  predicate: (value: SchemaOutput<TSchema>) => boolean,
  message: string = "Invalid value",
): Schema<SchemaInput<TSchema>, SchemaOutput<TSchema>> {
  return schema((value) => {
    const result = inner["~standard"].validate(value);
    ensureSynchronous(result);
    if (result.issues) {
      return result;
    }
    return predicate(result.value as SchemaOutput<TSchema>) ? result : failure(message);
  });
}

export function transform<TSchema extends Schema, TOutput>(
  inner: TSchema,
  mapper: (value: SchemaOutput<TSchema>) => TOutput,
): Schema<SchemaInput<TSchema>, TOutput> {
  return schema((value) => {
    const result = inner["~standard"].validate(value);
    ensureSynchronous(result);
    if (result.issues) {
      return result;
    }
    return success(mapper(result.value as SchemaOutput<TSchema>));
  });
}

export function pipe<TLeft extends Schema, TRight extends Schema>(
  left: TLeft,
  right: TRight,
): Schema<SchemaInput<TLeft>, SchemaOutput<TRight>> {
  return schema((value) => {
    const leftResult = left["~standard"].validate(value);
    ensureSynchronous(leftResult);
    if (leftResult.issues) {
      return leftResult;
    }
    const rightResult = right["~standard"].validate(leftResult.value as SchemaOutput<TLeft>);
    ensureSynchronous(rightResult);
    return rightResult as SchemaResult<SchemaOutput<TRight>>;
  });
}

export function extend<TBase extends SchemaShape, TExtension extends SchemaShape>(
  base: TBase,
  extension: TExtension,
): TBase & TExtension {
  return { ...base, ...extension };
}

export function pick<TShape extends SchemaShape, const TKeys extends readonly (keyof TShape)[]>(
  shape: TShape,
  keys: TKeys,
): Pick<TShape, TKeys[number]> {
  return Object.fromEntries(keys.map((key) => [key, shape[key]])) as Pick<TShape, TKeys[number]>;
}

export function omit<TShape extends SchemaShape, const TKeys extends readonly (keyof TShape)[]>(
  shape: TShape,
  keys: TKeys,
): Omit<TShape, TKeys[number]> {
  const keySet = new Set<PropertyKey>(keys as readonly PropertyKey[]);
  return Object.fromEntries(Object.entries(shape).filter(([key]) => !keySet.has(key))) as Omit<
    TShape,
    TKeys[number]
  >;
}

export function partial<TShape extends SchemaShape>(
  shape: TShape,
): { readonly [TKey in keyof TShape]: Schema<unknown, SchemaOutput<TShape[TKey]> | undefined> } {
  return Object.fromEntries(
    Object.entries(shape).map(([key, value]) => [key, optional(value)]),
  ) as { readonly [TKey in keyof TShape]: Schema<unknown, SchemaOutput<TShape[TKey]> | undefined> };
}

function ensureSynchronous<T>(value: T | Promise<T>): asserts value is T {
  if (value instanceof Promise) {
    StandardSchemaAsyncValidationError.unsupported();
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
  safeParse,
  safeParseSync,
  parse,
  parseSync,
  unknown,
  string,
  number,
  finite,
  integer,
  safeInteger,
  positiveNumber,
  nonNegativeNumber,
  positiveSafeInteger,
  nonNegativeSafeInteger,
  min,
  max,
  nonEmptyString,
  nonBlankString,
  boolean,
  fn,
  instanceOf,
  literal,
  picklist,
  union,
  array,
  object,
  strictObject,
  looseObject,
  record,
  optional,
  defaulted,
  refine,
  transform,
  pipe,
  extend,
  pick,
  omit,
  partial,
};
