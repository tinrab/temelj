import { ss } from "@temelj/standard-schema";
import { isPlainObject } from "@temelj/value";

import type { HelperDeclareSpec, HelperDelegate } from "../types";

import { createHelper } from "../helper_builder";

export function getObjectHelpers(): HelperDeclareSpec {
  return {
    object: createHelper()
      .hash(ss.record(ss.unknown()))
      .handle((hash) => hash),
    objectPick: ((obj: unknown, ...keys: string[]) => {
      if (!isPlainObject(obj)) {
        return {};
      }
      const result: Record<string, unknown> = {};
      for (const key of keys) {
        if (key in obj) {
          result[key] = obj[key];
        }
      }
      return result;
    }) as unknown as HelperDelegate,
  };
}
