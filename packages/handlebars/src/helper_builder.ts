import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { HelperOptions } from "handlebars";

import { isObject, isString } from "@temelj/value";

import type { HelperDelegate } from "./types";

export interface HelperContext extends Pick<HelperOptions, "hash" | "data"> {
  readonly name: string;
}

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
  handle: <TResult>(handler: (context: HelperContext) => TResult) => HelperDelegate;
}

interface HelperBuilderWithParams<TParams extends ParamSchemas> {
  hash: <THash extends Schema>(schema: THash) => HelperBuilderWithParamsAndHash<TParams, THash>;
  handle: <TResult>(
    handler: (params: ParamOutputs<TParams>, context: HelperContext) => TResult,
  ) => HelperDelegate;
}

interface HelperBuilderWithHash<THash extends Schema> {
  params: <TParams extends ParamSchemas>(
    ...schemas: TParams
  ) => HelperBuilderWithParamsAndHash<TParams, THash>;
  handle: <TResult>(
    handler: (hash: SchemaOutput<THash>, context: HelperContext) => TResult,
  ) => HelperDelegate;
}

interface HelperBuilderWithParamsAndHash<TParams extends ParamSchemas, THash extends Schema> {
  handle: <TResult>(
    handler: (
      params: ParamOutputs<TParams>,
      hash: SchemaOutput<THash>,
      context: HelperContext,
    ) => TResult,
  ) => HelperDelegate;
}

function withParams<TParams extends ParamSchemas>(
  schemas: TParams,
): HelperBuilderWithParams<TParams> {
  return {
    hash: (schema) => withParamsAndHash(schemas, schema),
    handle(handler) {
      return (...args) => {
        const context = helperContext(args);

        return handler(validateParams(schemas, args.slice(0, -1), context), context);
      };
    },
  };
}

function withHash<THash extends Schema>(schema: THash): HelperBuilderWithHash<THash> {
  return {
    params: (...schemas) => withParamsAndHash(schemas, schema),
    handle(handler) {
      return (...args) => {
        const context = helperContext(args);

        return handler(validateSchema(schema, context.hash, context, "hash"), context);
      };
    },
  };
}

function withParamsAndHash<TParams extends ParamSchemas, THash extends Schema>(
  schemas: TParams,
  schema: THash,
): HelperBuilderWithParamsAndHash<TParams, THash> {
  return {
    handle(handler) {
      return (...args) => {
        const context = helperContext(args);
        const params = validateParams(schemas, args.slice(0, -1), context);
        const hash = validateSchema(schema, context.hash, context, "hash");

        return handler(params, hash, context);
      };
    },
  };
}

function helperContext(args: readonly unknown[]): HelperContext {
  const context = args.at(-1);

  if (!isHelperContext(context)) {
    throw new TypeError("Invalid Handlebars helper context");
  }

  return context;
}

function isHelperContext(value: unknown): value is HelperContext {
  return (
    isObject(value) &&
    "name" in value &&
    isString(value.name) &&
    "hash" in value &&
    isObject(value.hash)
  );
}

function validateParams<TParams extends ParamSchemas>(
  schemas: TParams,
  values: readonly unknown[],
  context: HelperContext,
): ParamOutputs<TParams> {
  // SAFETY: map preserves the schema tuple length and validates each output at the same index.
  return schemas.map((schema, index) =>
    validateSchema(schema, values[index], context, index),
  ) as ParamOutputs<TParams>;
}

function validateSchema<TSchema extends Schema>(
  schema: TSchema,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Standard Schema validates the untrusted helper argument at this boundary.
  value: unknown,
  context: HelperContext,
  path: PropertyKey,
): SchemaOutput<TSchema> {
  const result = schema["~standard"].validate(value);

  if (result instanceof Promise) {
    HandlebarsHelperError.asyncSchemaUnsupported(context.name);
  }

  if (!result.issues) {
    // SAFETY: A successful Standard Schema result contains the output promised by this schema.
    return result.value as SchemaOutput<TSchema>;
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
  return {
    params: (...schemas) => withParams(schemas),
    hash: withHash,
    handle:
      (handler) =>
      (...args) =>
        handler(helperContext(args)),
  };
}
