import { z } from "zod";

import type { HelperDelegate } from "./types";

type HelperContext = any;

type HelperResult = any; // `JsonValue | SafeString`

interface HelperZodBuilder {
  params: <TParams extends [] | [z.core.SomeType, ...z.core.SomeType[]]>(
    ...schemas: TParams
  ) => HelperZodBuilderWithParams<TParams>;
  hash: <THash extends z.ZodSchema>(
    schema: THash,
  ) => HelperZodBuilderWithHash<THash>;
  handle: (handler: (context: HelperContext) => HelperResult) => HelperDelegate;
}

interface HelperZodBuilderWithParams<
  TParams extends [] | [z.core.SomeType, ...z.core.SomeType[]],
> {
  hash: <THash extends z.ZodSchema>(
    schema: THash,
  ) => HelperZodBuilderWithParamsAndHash<TParams, THash>;
  handle: (
    handler: (
      params: TParams extends []
        ? []
        : {
            [K in keyof TParams]: z.output<TParams[K]>;
          },
      context: HelperContext,
    ) => HelperResult,
  ) => HelperDelegate;
}

interface HelperZodBuilderWithHash<THash extends z.ZodSchema> {
  params: <T extends [] | [z.core.SomeType, ...z.core.SomeType[]]>(
    ...schemas: T
  ) => HelperZodBuilderWithParamsAndHash<T, THash>;
  handle: (
    handler: (hash: z.output<THash>, context: HelperContext) => HelperResult,
  ) => HelperDelegate;
}

interface HelperZodBuilderWithParamsAndHash<
  TParams extends [] | [z.core.SomeType, ...z.core.SomeType[]],
  THash extends z.ZodSchema,
> {
  handle: (
    handler: (
      params: TParams extends []
        ? []
        : {
            [K in keyof TParams]: z.output<TParams[K]>;
          },
      hash: z.output<THash>,
      context: HelperContext,
    ) => HelperResult,
  ) => HelperDelegate;
}

class HelperZodBuilderImpl implements HelperZodBuilder {
  private _paramsSchema?: z.ZodSchema;
  private _hashSchema?: z.ZodSchema;

  constructor(paramsSchema?: z.ZodSchema, hashSchema?: z.ZodSchema) {
    this._paramsSchema = paramsSchema;
    this._hashSchema = hashSchema;
  }

  params<TParams extends [] | [z.core.SomeType, ...z.core.SomeType[]]>(
    ...schemas: TParams
  ): HelperZodBuilderWithParams<TParams> {
    return new HelperZodBuilderImpl(
      z.tuple(schemas as []),
      this._hashSchema,
    ) as unknown as HelperZodBuilderWithParams<TParams>;
  }

  hash<THash extends z.ZodSchema>(
    schema: THash,
  ): HelperZodBuilderWithHash<THash> {
    return new HelperZodBuilderImpl(
      this._paramsSchema,
      schema,
    ) as unknown as HelperZodBuilderWithHash<THash>;
  }

  handle(handler: (...args: any[]) => HelperResult): HelperDelegate {
    return (...args: any[]) => {
      const context = args[args.length - 1] as HelperContext;

      let params: unknown[] | undefined;
      if (this._paramsSchema instanceof z.ZodTuple) {
        const paramsCount = this._paramsSchema.def.items.length;
        const paramArgs = args.slice(0, -1);
        if (paramArgs.length < paramsCount) {
          paramArgs.push(
            ...Array.from({ length: paramsCount - paramArgs.length }),
          );
        }
        try {
          params = this._paramsSchema.parse(paramArgs);
        } catch (error) {
          if (error instanceof z.ZodError) {
            error.issues.push({
              code: "custom",
              message: `Input validation error in Handlebars helper '${context.name}'`,
              path: [],
              input: paramArgs,
            });
          }
          throw error;
        }
      }

      let hash: unknown | undefined;
      if (this._hashSchema !== undefined) {
        try {
          hash = this._hashSchema.parse(context?.hash);
        } catch (error) {
          if (error instanceof z.ZodError) {
            error.issues.push({
              code: "custom",
              message: `Input validation error in Handlebars helper '${context.name}'`,
              path: [],
              input: context?.hash,
            });
          }
          throw error;
        }
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

export function createHelperZod(): HelperZodBuilder {
  return new HelperZodBuilderImpl();
}
