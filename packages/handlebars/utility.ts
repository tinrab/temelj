import { z } from "zod";
import type { JsonValue } from "@temelj/value";

import type { HelperDelegate } from "./helpers/types.ts";

interface HelperBuilder {
  params: <T extends [] | [z.ZodTypeAny, ...z.ZodTypeAny[]]>(
    ...schemas: T
  ) => HelperBuilderWithParams<T>;
  hash: <T extends z.ZodSchema>(schema: T) => HelperBuilderWithHash<T>;
  handle: (handler: () => JsonValue) => HelperDelegate;
}

interface HelperBuilderWithParams<
  TParams extends [] | [z.ZodTypeAny, ...z.ZodTypeAny[]],
> {
  hash: <T extends z.ZodSchema>(
    schema: T,
  ) => HelperBuilderWithParamsAndHash<TParams, T>;
  handle: (
    handler: (params: z.OutputTypeOfTuple<TParams>) => JsonValue,
  ) => HelperDelegate;
}

interface HelperBuilderWithHash<THash extends z.ZodSchema> {
  params: <T extends [] | [z.ZodTypeAny, ...z.ZodTypeAny[]]>(
    ...schemas: T
  ) => HelperBuilderWithParamsAndHash<T, THash>;
  handle: (handler: (hash: z.output<THash>) => JsonValue) => HelperDelegate;
}

interface HelperBuilderWithParamsAndHash<
  TParams extends [] | [z.ZodTypeAny, ...z.ZodTypeAny[]],
  THash extends z.ZodSchema,
> {
  handle: (
    handler: (
      params: z.OutputTypeOfTuple<TParams>,
      hash: z.output<THash>,
    ) => JsonValue,
  ) => HelperDelegate;
}

class HelperBuilderImpl implements HelperBuilder {
  constructor(
    private _paramsSchema?: z.ZodSchema,
    private _hashSchema?: z.ZodSchema,
  ) {}

  params<T extends [] | [z.ZodTypeAny, ...z.ZodTypeAny[]]>(
    ...schemas: T
  ): HelperBuilderWithParams<T> {
    return new HelperBuilderImpl(
      z.tuple(schemas),
      this._hashSchema,
    ) as unknown as HelperBuilderWithParams<T>;
  }

  hash<T extends z.ZodSchema>(schema: T): HelperBuilderWithHash<T> {
    return new HelperBuilderImpl(
      this._paramsSchema,
      schema,
    ) as unknown as HelperBuilderWithHash<T>;
  }

  handle(handler: (...args: unknown[]) => JsonValue): HelperDelegate {
    return (...args: unknown[]) => {
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
        const context = args[args.length - 1] as Record<string, unknown>;
        hash = this._hashSchema.parse(context?.hash);
      }

      return params === undefined
        ? hash === undefined ? handler() : handler(hash)
        : hash === undefined
        ? handler(params)
        : handler(params, hash);
    };
  }
}

export function createHelper(): HelperBuilder {
  return new HelperBuilderImpl();
}
