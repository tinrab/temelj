import { ss } from "@temelj/standard-schema";
import { isPlainObject, isString, type PrimitiveValue } from "@temelj/value";

import type { HelperDeclareSpec } from "../types";

import { createHelper } from "../helper_builder";

export function getObjectHelpers(): HelperDeclareSpec {
  return {
    object: createHelper()
      .hash(ss.record(ss.unknown()))
      .handle((hash) => hash),
    objectPick: (obj: PrimitiveValue, ...keys: unknown[]) => {
      if (!isPlainObject(obj)) {
        return {};
      }

      const selectedKeys = keys.filter(isString);
      const result: Record<string, PrimitiveValue> = {};

      for (const [key, value] of Object.entries(obj)) {
        if (selectedKeys.includes(key)) {
          Object.defineProperty(result, key, {
            value,
            enumerable: true,
            configurable: true,
            writable: true,
          });
        }
      }

      return result;
    },
  };
}
