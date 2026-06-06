import { ss } from "@temelj/standard-schema";
import { isObjectPrimitive } from "@temelj/value";

import type { HelperDeclareSpec, HelperDelegate } from "../types";

import { createHelper } from "../helper_builder";

export function getObjectHelpers(): HelperDeclareSpec {
  return {
    object: createHelper()
      .hash(ss.record(ss.unknown()))
      .handle((hash) => hash),
    objectPick: ((obj: unknown, ...keys: string[]) => {
      if (!isObjectPrimitive(obj)) {
        return {};
      }
      const result: Record<string, unknown> = {};
      const objRecord = obj as Record<string, unknown>;
      for (const key of keys) {
        if (key in objRecord) {
          result[key] = objRecord[key];
        }
      }
      return result;
    }) as unknown as HelperDelegate,
  };
}
