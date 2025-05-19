// deno-lint-ignore-file no-explicit-any

import { z } from "zod";
import type { JsonValue } from "@temelj/value";

import type { HelperDelegate } from "./types.ts";

type HelperContext = any;

interface HelperZodBuilder {
  params: <TParams extends [] | [z.ZodTypeAny, ...z.ZodTypeAny[]]>(
    ...schemas: TParams
  ) => HelperZodBuilderWithParams<TParams>;
  hash: <THash extends z.ZodSchema>(
    schema: THash,
  ) => HelperZodBuilderWithHash<THash>;
  handle: (handler: (context: HelperContext) => JsonValue) => HelperDelegate;
}

interface HelperZodBuilderWithParams<
  TParams extends [] | [z.ZodTypeAny, ...z.ZodTypeAny[]],
> {
  hash: <THash extends z.ZodSchema>(
    schema: THash,
  ) => HelperZodBuilderWithParamsAndHash<TParams, THash>;
  handle: (
    handler: (
      params: z.OutputTypeOfTuple<TParams>,
      context: HelperContext,
    ) => JsonValue,
  ) => HelperDelegate;
}

interface HelperZodBuilderWithHash<THash extends z.ZodSchema> {
  params: <T extends [] | [z.ZodTypeAny, ...z.ZodTypeAny[]]>(
    ...schemas: T
  ) => HelperZodBuilderWithParamsAndHash<T, THash>;
  handle: (
    handler: (hash: z.output<THash>, context: HelperContext) => JsonValue,
  ) => HelperDelegate;
}

interface HelperZodBuilderWithParamsAndHash<
  TParams extends [] | [z.ZodTypeAny, ...z.ZodTypeAny[]],
  THash extends z.ZodSchema,
> {
  handle: (
    handler: (
      params: z.OutputTypeOfTuple<TParams>,
      hash: z.output<THash>,
      context: HelperContext,
    ) => JsonValue,
  ) => HelperDelegate;
}

class HelperZodBuilderImpl implements HelperZodBuilder {
  constructor(
    private _paramsSchema?: z.ZodSchema,
    private _hashSchema?: z.ZodSchema,
  ) {}

  params<TParams extends [] | [z.ZodTypeAny, ...z.ZodTypeAny[]]>(
    ...schemas: TParams
  ): HelperZodBuilderWithParams<TParams> {
    return new HelperZodBuilderImpl(
      z.tuple(schemas),
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

  handle(handler: (...args: any[]) => JsonValue): HelperDelegate {
    return (...args: any[]) => {
      const context = args[args.length - 1] as HelperContext;

      try {
        let params: unknown[] | undefined;
        if (this._paramsSchema instanceof z.ZodTuple) {
          const paramsCount = this._paramsSchema._def.items.length;
          const paramArgs = args.slice(0, -1);
          if (paramArgs.length < paramsCount) {
            paramArgs.push(
              ...Array.from({ length: paramsCount - paramArgs.length }),
            );
          }
          params = this._paramsSchema.parse(paramArgs);
        }

        let hash: unknown | undefined;
        if (this._hashSchema !== undefined) {
          hash = this._hashSchema.parse(context?.hash);
        }

        return params === undefined
          ? hash === undefined ? handler(context) : handler(hash, context)
          : hash === undefined
          ? handler(params, context)
          : handler(params, hash, context);
      } catch (error) {
        if (error instanceof z.ZodError) {
          error.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              `Input validation error in Handlebars helper '${context.name}'`,
            path: [],
            params: { context },
          });
        }
        throw error;
      }
    };
  }
}

export function createHelperZod(): HelperZodBuilder {
  return new HelperZodBuilderImpl();
}
