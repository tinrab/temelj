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

  constructor(message: string, issues: ReadonlyArray<StandardSchemaV1.Issue>, context?: Function) {
    super(message);
    this.name = "StandardSchemaValidationError";
    this.issues = issues;

    if (Error.captureStackTrace !== undefined) {
      Error.captureStackTrace(this, context ?? this.constructor);
    }
  }

  static failed(this: void, message: string, issues: ReadonlyArray<StandardSchemaV1.Issue>): never {
    throw new StandardSchemaValidationError(message, issues, StandardSchemaValidationError.failed);
  }
}

export class HandlebarsHelperError extends Error {
  constructor(message: string, context?: Function) {
    super(message);
    this.name = "HandlebarsHelperError";

    if (Error.captureStackTrace !== undefined) {
      Error.captureStackTrace(this, context ?? this.constructor);
    }
  }

  static asyncSchemaUnsupported(this: void, helperName: string): never {
    throw new HandlebarsHelperError(
      `Async schema validation is not supported in Handlebars helper '${helperName}'`,
      HandlebarsHelperError.asyncSchemaUnsupported,
    );
  }

  static partialNotFound(this: void, path: string): never {
    throw new HandlebarsHelperError(
      `Partial "${path}" not found`,
      HandlebarsHelperError.partialNotFound,
    );
  }
}

interface HelperBuilderContract {
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

class HelperBuilder implements HelperBuilderContract {
  private _paramsSchemas?: readonly Schema[];
  private _hashSchema?: Schema;

  constructor(paramsSchemas?: readonly Schema[], hashSchema?: Schema) {
    this._paramsSchemas = paramsSchemas;
    this._hashSchema = hashSchema;
  }

  params<TParams extends ParamSchemas>(...schemas: TParams): HelperBuilderWithParams<TParams> {
    return new HelperBuilder(
      schemas,
      this._hashSchema,
    ) as unknown as HelperBuilderWithParams<TParams>;
  }

  hash<THash extends Schema>(schema: THash): HelperBuilderWithHash<THash> {
    return new HelperBuilder(
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
    HandlebarsHelperError.asyncSchemaUnsupported(context.name);
  }
  if (!result.issues) {
    return result.value;
  }

  StandardSchemaValidationError.failed(
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

export function createHelper(): HelperBuilderContract {
  return new HelperBuilder();
}
