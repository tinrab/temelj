import * as v from "valibot";
import type { JsonValue } from "@temelj/value";

import type { HelperDelegate } from "./helpers/types.ts";

type BaseSchema = v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>;

interface HelperValibotBuilder {
  params: <TParams extends v.TupleItems>(
    ...schemas: TParams
  ) => HelperValibotBuilderWithParams<TParams>;
  hash: <THash extends BaseSchema>(
    schema: THash,
  ) => HelperValibotBuilderWithHash<THash>;
  handle: (handler: () => JsonValue) => HelperDelegate;
}

interface HelperValibotBuilderWithParams<
  TParams extends v.TupleItems,
> {
  hash: <THash extends BaseSchema>(
    schema: THash,
  ) => HelperValibotBuilderWithParamsAndHash<TParams, THash>;
  handle: (
    handler: (params: v.InferTupleOutput<TParams>) => JsonValue,
  ) => HelperDelegate;
}

interface HelperValibotBuilderWithHash<THash extends BaseSchema> {
  params: <TParams extends [] | [BaseSchema, ...BaseSchema[]]>(
    ...schemas: TParams
  ) => HelperValibotBuilderWithParamsAndHash<TParams, THash>;
  handle: (
    handler: (hash: v.InferOutput<THash>) => JsonValue,
  ) => HelperDelegate;
}

interface HelperValibotBuilderWithParamsAndHash<
  TParams extends v.TupleItems,
  THash extends BaseSchema,
> {
  handle: (
    handler: (
      params: v.InferTupleOutput<TParams>,
      hash: v.InferOutput<THash>,
    ) => JsonValue,
  ) => HelperDelegate;
}

class HelperValibotBuilderImpl implements HelperValibotBuilder {
  constructor(
    private _paramsSchema?: BaseSchema,
    private _hashSchema?: BaseSchema,
  ) {}

  params<TParams extends v.TupleItems>(
    ...schemas: TParams
  ): HelperValibotBuilderWithParams<TParams> {
    return new HelperValibotBuilderImpl(
      v.tuple(schemas),
      this._hashSchema,
    ) as unknown as HelperValibotBuilderWithParams<TParams>;
  }

  hash<THash extends BaseSchema>(
    schema: THash,
  ): HelperValibotBuilderWithHash<THash> {
    return new HelperValibotBuilderImpl(
      this._paramsSchema,
      schema,
    ) as unknown as HelperValibotBuilderWithHash<THash>;
  }

  handle(handler: (...args: unknown[]) => JsonValue): HelperDelegate {
    return (...args: unknown[]) => {
      let params: unknown[] | undefined;
      if (
        this._paramsSchema && "items" in this._paramsSchema &&
        Array.isArray(this._paramsSchema.items)
      ) {
        const paramsCount = this._paramsSchema.items.length;
        const paramArgs = args.slice(0, -1);
        if (paramArgs.length < paramsCount) {
          paramArgs.push(
            ...Array.from({ length: paramsCount - paramArgs.length }),
          );
        }
        params = v.parse(this._paramsSchema, paramArgs) as unknown[];
      }

      let hash: unknown | undefined;
      if (this._hashSchema !== undefined) {
        const context = args[args.length - 1] as Record<string, unknown>;
        hash = v.parse(this._hashSchema, context?.hash);
      }

      return params === undefined
        ? hash === undefined ? handler() : handler(hash)
        : hash === undefined
        ? handler(params)
        : handler(params, hash);
    };
  }
}

export function createHelperValibot(): HelperValibotBuilder {
  return new HelperValibotBuilderImpl();
}
