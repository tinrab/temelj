import type { StandardSchemaV1 } from "@standard-schema/spec";

import type { HelperDelegate } from "./types";

type HelperContext = any;
type HelperResult = any; // `JsonValue | SafeString`
type Schema = StandardSchemaV1;
type SchemaOutput<TSchema extends Schema> = StandardSchemaV1.InferOutput<TSchema>;
type ParamSchemas = [] | [Schema, ...Schema[]];
type ParamOutputs<TParams extends ParamSchemas> = TParams extends []
  ? []
  : { [K in keyof TParams]: SchemaOutput<TParams[K]> };

export class StandardSchemaValidationError extends Error {
  public readonly issues: ReadonlyArray<StandardSchemaV1.Issue>;

  constructor(message: string, issues: ReadonlyArray<StandardSchemaV1.Issue>) {
    super(message);
    this.name = "StandardSchemaValidationError";
    this.issues = issues;
  }
}

interface HelperBuilder {
  params: <TParams extends ParamSchemas>(...schemas: TParams) => HelperBuilderWithParams<TParams>;
  hash: <THash extends Schema>(schema: THash) => HelperBuilderWithHash<THash>;
  handle: (handler: (context: HelperContext) => HelperResult) => HelperDelegate;
}

interface HelperBuilderWithParams<TParams extends ParamSchemas> {
  hash: <THash extends Schema>(schema: THash) => HelperBuilderWithParamsAndHash<TParams, THash>;
  handle: (
    handler: (params: ParamOutputs<TParams>, context: HelperContext) => HelperResult,
  ) => HelperDelegate;
}

interface HelperBuilderWithHash<THash extends Schema> {
  params: <TParams extends ParamSchemas>(
    ...schemas: TParams
  ) => HelperBuilderWithParamsAndHash<TParams, THash>;
  handle: (
    handler: (hash: SchemaOutput<THash>, context: HelperContext) => HelperResult,
  ) => HelperDelegate;
}

interface HelperBuilderWithParamsAndHash<TParams extends ParamSchemas, THash extends Schema> {
  handle: (
    handler: (
      params: ParamOutputs<TParams>,
      hash: SchemaOutput<THash>,
      context: HelperContext,
    ) => HelperResult,
  ) => HelperDelegate;
}

class HelperBuilderImpl implements HelperBuilder {
  private _paramsSchemas?: readonly Schema[];
  private _hashSchema?: Schema;

  constructor(paramsSchemas?: readonly Schema[], hashSchema?: Schema) {
    this._paramsSchemas = paramsSchemas;
    this._hashSchema = hashSchema;
  }

  params<TParams extends ParamSchemas>(...schemas: TParams): HelperBuilderWithParams<TParams> {
    return new HelperBuilderImpl(
      schemas,
      this._hashSchema,
    ) as unknown as HelperBuilderWithParams<TParams>;
  }

  hash<THash extends Schema>(schema: THash): HelperBuilderWithHash<THash> {
    return new HelperBuilderImpl(
      this._paramsSchemas,
      schema,
    ) as unknown as HelperBuilderWithHash<THash>;
  }

  handle(handler: (...args: any[]) => HelperResult): HelperDelegate {
    return (...args: any[]) => {
      const context = args[args.length - 1] as HelperContext;

      let params: unknown[] | undefined;
      if (this._paramsSchemas !== undefined) {
        const paramArgs = args.slice(0, -1);
        if (paramArgs.length < this._paramsSchemas.length) {
          paramArgs.push(...Array.from({ length: this._paramsSchemas.length - paramArgs.length }));
        }
        params = validateParams(this._paramsSchemas, paramArgs, context);
      }

      let hash: unknown;
      if (this._hashSchema !== undefined) {
        hash = validateSchema(this._hashSchema, context?.hash, context, "hash");
      }

      return params === undefined
        ? hash === undefined
          ? handler(context)
          : handler(hash, context)
        : hash === undefined
          ? handler(params, context)
          : handler(params, hash, context);
    };
  }
}

function validateParams(
  schemas: readonly Schema[],
  values: readonly unknown[],
  context: HelperContext,
): unknown[] {
  return schemas.map((schema, index) => validateSchema(schema, values[index], context, index));
}

function validateSchema(
  schema: Schema,
  value: unknown,
  context: HelperContext,
  path: PropertyKey,
): unknown {
  const result = schema["~standard"].validate(value);
  if (result instanceof Promise) {
    throw new Error(
      `Async schema validation is not supported in Handlebars helper '${context.name}'`,
    );
  }
  if (!result.issues) {
    return result.value;
  }

  throw new StandardSchemaValidationError(
    `Input validation error in Handlebars helper '${context.name}'`,
    [
      ...result.issues.map((issue) => ({
        ...issue,
        path: [path, ...(issue.path ?? [])],
      })),
      {
        message: `Input validation error in Handlebars helper '${context.name}'`,
        path: [],
      },
    ],
  );
}

export function createHelper(): HelperBuilder {
  return new HelperBuilderImpl();
}

function schema<TInput, TOutput>(
  validate: (value: unknown) => StandardSchemaV1.Result<TOutput>,
): StandardSchemaV1<TInput, TOutput> {
  return {
    "~standard": {
      version: 1,
      vendor: "@temelj/handlebars",
      validate,
    },
  };
}

function success<T>(value: T): StandardSchemaV1.SuccessResult<T> {
  return { value };
}

function failure(message: string): StandardSchemaV1.FailureResult {
  return { issues: [{ message }] };
}

export const helperSchema = {
  unknown: (): StandardSchemaV1<unknown> => schema((value) => success(value)),
  string: (): StandardSchemaV1<unknown, string> =>
    schema((value) => (typeof value === "string" ? success(value) : failure("Expected string"))),
  number: (): StandardSchemaV1<unknown, number> =>
    schema((value) => (typeof value === "number" ? success(value) : failure("Expected number"))),
  boolean: (): StandardSchemaV1<unknown, boolean> =>
    schema((value) => (typeof value === "boolean" ? success(value) : failure("Expected boolean"))),
  array: <TItem extends Schema>(
    itemSchema?: TItem,
  ): StandardSchemaV1<unknown, SchemaOutput<TItem>[]> =>
    schema((value) => {
      if (!Array.isArray(value)) {
        return failure("Expected array");
      }
      if (itemSchema === undefined) {
        return success(value as SchemaOutput<TItem>[]);
      }
      const output: SchemaOutput<TItem>[] = [];
      const issues: StandardSchemaV1.Issue[] = [];
      for (let index = 0; index < value.length; index++) {
        const result = itemSchema["~standard"].validate(value[index]);
        if (result instanceof Promise) {
          throw new Error("Async schema validation is not supported");
        }
        if (result.issues) {
          issues.push(
            ...result.issues.map((issue) => ({
              ...issue,
              path: [index, ...(issue.path ?? [])],
            })),
          );
        } else {
          output.push(result.value as SchemaOutput<TItem>);
        }
      }
      return issues.length > 0 ? { issues } : success(output);
    }),
  record: <TValue extends Schema>(
    valueSchema: TValue,
  ): StandardSchemaV1<unknown, Record<string, SchemaOutput<TValue>>> =>
    schema((value) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return failure("Expected object");
      }
      const output: Record<string, SchemaOutput<TValue>> = {};
      const issues: StandardSchemaV1.Issue[] = [];
      for (const [key, item] of Object.entries(value)) {
        const result = valueSchema["~standard"].validate(item);
        if (result instanceof Promise) {
          throw new Error("Async schema validation is not supported");
        }
        if (result.issues) {
          issues.push(
            ...result.issues.map((issue) => ({
              ...issue,
              path: [key, ...(issue.path ?? [])],
            })),
          );
        } else {
          output[key] = result.value as SchemaOutput<TValue>;
        }
      }
      return issues.length > 0 ? { issues } : success(output);
    }),
  optional: <TSchema extends Schema>(
    inner: TSchema,
  ): StandardSchemaV1<unknown, SchemaOutput<TSchema> | undefined> =>
    schema((value) => {
      if (value === undefined) {
        return success(undefined);
      }
      const result = inner["~standard"].validate(value);
      if (result instanceof Promise) {
        throw new Error("Async schema validation is not supported");
      }
      return result;
    }),
  defaulted: <TSchema extends Schema>(
    inner: TSchema,
    defaultValue: SchemaOutput<TSchema>,
  ): StandardSchemaV1<unknown, SchemaOutput<TSchema>> =>
    schema((value) => {
      if (value === undefined) {
        return success(defaultValue);
      }
      const result = inner["~standard"].validate(value);
      if (result instanceof Promise) {
        throw new Error("Async schema validation is not supported");
      }
      return result;
    }),
};
