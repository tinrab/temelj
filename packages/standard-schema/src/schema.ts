import type { StandardSchemaV1 } from "@standard-schema/spec";

import { isString, isNumber, isBoolean, isFunction, isObject } from "@temelj/value";

export type Schema<TInput = unknown, TOutput = TInput> = StandardSchemaV1<TInput, TOutput>;

export type SchemaInput<TSchema extends Schema> = StandardSchemaV1.InferInput<TSchema>;

export type SchemaOutput<TSchema extends Schema> = StandardSchemaV1.InferOutput<TSchema>;

export type SchemaResult<TOutput> = StandardSchemaV1.Result<TOutput>;

export type SchemaIssue = StandardSchemaV1.Issue;

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Standard Schema validators receive untrusted input before validating it.
export type SchemaValidator<TOutput> = (value: unknown) => SchemaResult<TOutput>;

export type SchemaFields = Record<string, Schema>;

export type ObjectOutput<TFields extends SchemaFields> = {
  readonly [TKey in keyof TFields]: SchemaOutput<TFields[TKey]>;
};

export type ObjectInput<TFields extends SchemaFields> = {
  readonly [TKey in keyof TFields]: SchemaInput<TFields[TKey]>;
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
        path,
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
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Schema validation is the boundary that converts untrusted input to its declared output.
  value: unknown,
  message: string = "Schema validation failed",
): Promise<SchemaOutput<TSchema>> {
  const result = await inputSchema["~standard"].validate(value);

  if (!result.issues) {
    // SAFETY: this success result was returned by the supplied TSchema validator.
    return result.value as SchemaOutput<TSchema>;
  }

  StandardSchemaValidationError.failed(message, result.issues);
}

export function validateStandardSchemaSync<TSchema extends Schema>(
  inputSchema: TSchema,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Schema validation is the boundary that converts untrusted input to its declared output.
  value: unknown,
  message: string = "Schema validation failed",
): SchemaOutput<TSchema> {
  const result = evaluate(inputSchema, value);

  if (!result.issues) {
    return result.value;
  }

  StandardSchemaValidationError.failed(message, result.issues);
}

export async function safeParse<TSchema extends Schema>(
  inputSchema: TSchema,
  value: SchemaInput<TSchema>,
): Promise<SafeParseResult<SchemaOutput<TSchema>>> {
  const result = await inputSchema["~standard"].validate(value);

  // SAFETY: the success value was returned by the supplied TSchema validator.
  return result.issues
    ? { success: false, issues: result.issues }
    : { success: true, value: result.value as SchemaOutput<TSchema> };
}

export function safeParseSync<TSchema extends Schema>(
  inputSchema: TSchema,
  value: SchemaInput<TSchema>,
): SafeParseResult<SchemaOutput<TSchema>> {
  const result = evaluate(inputSchema, value);

  return result.issues
    ? { success: false, issues: result.issues }
    : { success: true, value: result.value };
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
  return schema((value) => (isString(value) ? success(value) : failure(message)));
}

export function number(message: string = "Expected a number"): Schema<unknown, number> {
  return schema((value) => (isNumber(value) ? success(value) : failure(message)));
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
  return schema((value) => (isBoolean(value) ? success(value) : failure(message)));
}

export function fn(message: string = "Expected a function"): Schema<unknown, Function> {
  return schema((value) => (isFunction(value) ? success(value) : failure(message)));
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
  return schema((value) => {
    const match = values.findIndex((item) => Object.is(item, value));

    return match === -1 ? failure(message) : success(values[match]);
  });
}

export function union<const TSchemas extends readonly [Schema, ...Schema[]]>(
  schemas: TSchemas,
  message: string = "Expected a union match",
): Schema<unknown, SchemaOutput<TSchemas[number]>> {
  return schema((value) => {
    for (const itemSchema of schemas) {
      const result = evaluate<TSchemas[number]>(itemSchema, value);

      if (!result.issues) {
        return success(result.value);
      }
    }

    return failure(message);
  });
}

export function array(): Schema<unknown, unknown[]>;
export function array<TItem extends Schema>(
  itemSchema: TItem,
  message?: string,
): Schema<unknown, SchemaOutput<TItem>[]>;
export function array<TItem extends Schema>(
  itemSchema?: TItem,
  message: string = "Expected an array",
): Schema<unknown, unknown[]> {
  return schema((value) => {
    if (!Array.isArray(value)) {
      return failure(message);
    }

    if (itemSchema === undefined) {
      return success(value);
    }

    const output: SchemaOutput<TItem>[] = [];
    const issues: SchemaIssue[] = [];

    for (let index = 0; index < value.length; index++) {
      const result: SchemaResult<SchemaOutput<TItem>> = evaluate(itemSchema, value[index]);

      if (result.issues) {
        issues.push(...result.issues.map((issue: SchemaIssue) => withPath(index, issue)));
      } else {
        output.push(result.value);
      }
    }

    return issues.length > 0 ? { issues } : success(output);
  });
}

export function object<TFields extends SchemaFields>(
  fields: TFields,
  message: string = "Expected an object",
  options: ObjectOptions = {},
): Schema<unknown, ObjectOutput<TFields>> {
  return schema((value) => {
    if (!isObject(value) || Array.isArray(value)) {
      return failure(message);
    }

    // SAFETY: the object check above establishes key lookup; each field remains unknown until its schema validates it.
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Temporary untrusted object at the schema parsing boundary.
    const input = value as Record<PropertyKey, unknown>;

    const output: Partial<{ -readonly [K in keyof TFields]: SchemaOutput<TFields[K]> }> = {};

    if (options.unknownKeys === "passthrough") {
      for (const key of Reflect.ownKeys(input)) {
        if (!Object.prototype.propertyIsEnumerable.call(input, key)) {
          continue;
        }

        Object.defineProperty(output, key, {
          value: input[key],
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
    }

    const issues: SchemaIssue[] = [];
    const fieldKeys = Object.keys(fields);

    if (options.unknownKeys === "strict") {
      for (const key of Object.keys(input)) {
        if (!fieldKeys.includes(key)) {
          issues.push({ message: "Unexpected key", path: [key] });
        }
      }
    }

    // SAFETY: these are the enumerable keys of the supplied field schema object.
    for (const key of fieldKeys as Array<keyof TFields & string>) {
      const hasOwnField = Object.prototype.hasOwnProperty.call(input, key);
      const result = evaluate(fields[key], hasOwnField ? input[key] : undefined);

      if (result.issues) {
        issues.push(...result.issues.map((issue: SchemaIssue) => withPath(key, issue)));
      } else if (hasOwnField || result.value !== undefined) {
        Object.defineProperty(output, key, {
          value: result.value,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
    }

    // SAFETY: all schema fields have succeeded; absent optional fields are represented by undefined in ObjectOutput.
    return issues.length > 0 ? { issues } : success(output as ObjectOutput<TFields>);
  });
}

export function strictObject<TFields extends SchemaFields>(
  fields: TFields,
  message: string = "Expected an object",
): Schema<unknown, ObjectOutput<TFields>> {
  return object(fields, message, { unknownKeys: "strict" });
}

export function looseObject<TFields extends SchemaFields>(
  fields: TFields,
  message: string = "Expected an object",
): Schema<unknown, ObjectOutput<TFields>> {
  return object(fields, message, { unknownKeys: "passthrough" });
}

export function record<TValue extends Schema>(
  valueSchema: TValue,
  message: string = "Expected an object",
): Schema<unknown, Record<string, SchemaOutput<TValue>>> {
  return schema((value) => {
    if (!isObject(value) || Array.isArray(value)) {
      return failure(message);
    }

    const output: Record<string, SchemaOutput<TValue>> = {};
    const issues: SchemaIssue[] = [];

    for (const [key, item] of Object.entries(value)) {
      const result = evaluate(valueSchema, item);

      if (result.issues) {
        issues.push(...result.issues.map((issue: SchemaIssue) => withPath(key, issue)));
      } else {
        output[key] = result.value;
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

    const result = evaluate(inner, value);

    return result;
  });
}

export function defaulted<TSchema extends Schema>(
  inner: TSchema,
  defaultValue: SchemaOutput<TSchema>,
): Schema<unknown, SchemaOutput<TSchema>> {
  return schema((value) => {
    if (value === undefined) {
      return success(defaultValue);
    }

    const result = evaluate(inner, value);

    return result;
  });
}

export function defaultedWith<TSchema extends Schema>(
  inner: TSchema,
  createDefault: () => SchemaOutput<TSchema>,
): Schema<unknown, SchemaOutput<TSchema>> {
  return schema((value) =>
    value === undefined ? success(createDefault()) : evaluate(inner, value),
  );
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
    const result = evaluate(inner, value);

    if (result.issues) {
      return result;
    }

    return predicate(result.value) ? result : failure(message);
  });
}

export function transform<TSchema extends Schema, TOutput>(
  inner: TSchema,
  mapper: (value: SchemaOutput<TSchema>) => TOutput,
): Schema<SchemaInput<TSchema>, TOutput> {
  return schema((value) => {
    const result = evaluate(inner, value);

    if (result.issues) {
      return result;
    }

    return success(mapper(result.value));
  });
}

export function pipe<TLeft extends Schema, TRight extends Schema>(
  left: TLeft,
  right: TRight,
): Schema<SchemaInput<TLeft>, SchemaOutput<TRight>> {
  return schema((value) => {
    const leftResult = evaluate(left, value);

    if (leftResult.issues) {
      return leftResult;
    }

    const rightResult = evaluate(right, leftResult.value);

    return rightResult;
  });
}

export function extend<TBase extends SchemaFields, TExtension extends SchemaFields>(
  base: TBase,
  extension: TExtension,
): Omit<TBase, keyof TExtension> & TExtension {
  return { ...base, ...extension };
}

export function pick<TFields extends SchemaFields, const TKeys extends readonly (keyof TFields)[]>(
  fields: TFields,
  keys: TKeys,
): Pick<TFields, TKeys[number]> {
  // SAFETY: each requested key is constrained to TFields and is copied with its corresponding schema.
  return Object.fromEntries(keys.map((key) => [key, fields[key]])) as Pick<TFields, TKeys[number]>;
}

export function omit<TFields extends SchemaFields, const TKeys extends readonly (keyof TFields)[]>(
  fields: TFields,
  keys: TKeys,
): Omit<TFields, TKeys[number]> {
  const result = { ...fields };

  for (const key of keys) {
    delete result[key];
  }

  return result;
}

export function partial<TFields extends SchemaFields>(
  fields: TFields,
): { readonly [TKey in keyof TFields]: Schema<unknown, SchemaOutput<TFields[TKey]> | undefined> } {
  const entries = Reflect.ownKeys(fields).map((key) => {
    // SAFETY: key is an own key of the supplied field schema object.
    return [key, optional(fields[key as keyof TFields])];
  });

  // SAFETY: each own field is preserved under its key and optional retains its output type while adding undefined.
  return Object.fromEntries(entries) as {
    readonly [TKey in keyof TFields]: Schema<unknown, SchemaOutput<TFields[TKey]> | undefined>;
  };
}

function evaluate<TSchema extends Schema>(
  inputSchema: TSchema,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This helper invokes the schema validator on untrusted input.
  value: unknown,
): SchemaResult<SchemaOutput<TSchema>> {
  const result = inputSchema["~standard"].validate(value);
  ensureSynchronous(result);

  // SAFETY: StandardSchemaV1 ties the validator success type to TSchema's declared output.
  return result as SchemaResult<SchemaOutput<TSchema>>;
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
