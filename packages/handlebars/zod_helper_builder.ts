import { z } from "zod";
import type { JsonValue } from "@temelj/value";

import type { HelperDelegate } from "./helpers/types.ts";

interface HelperZodBuilder {
  params: <TParams extends [] | [z.ZodTypeAny, ...z.ZodTypeAny[]]>(
    ...schemas: TParams
  ) => HelperZodBuilderWithParams<TParams>;
  hash: <THash extends z.ZodSchema>(
    schema: THash,
  ) => HelperZodBuilderWithHash<THash>;
  handle: (handler: () => JsonValue) => HelperDelegate;
}

interface HelperZodBuilderWithParams<
  TParams extends [] | [z.ZodTypeAny, ...z.ZodTypeAny[]],
> {
  hash: <THash extends z.ZodSchema>(
    schema: THash,
  ) => HelperZodBuilderWithParamsAndHash<TParams, THash>;
  handle: (
    handler: (params: z.OutputTypeOfTuple<TParams>) => JsonValue,
  ) => HelperDelegate;
}

interface HelperZodBuilderWithHash<THash extends z.ZodSchema> {
  params: <T extends [] | [z.ZodTypeAny, ...z.ZodTypeAny[]]>(
    ...schemas: T
  ) => HelperZodBuilderWithParamsAndHash<T, THash>;
  handle: (handler: (hash: z.output<THash>) => JsonValue) => HelperDelegate;
}

interface HelperZodBuilderWithParamsAndHash<
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

export function createHelperZod(): HelperZodBuilder {
  return new HelperZodBuilderImpl();
}
