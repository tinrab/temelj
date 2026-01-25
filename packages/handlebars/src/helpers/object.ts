import { isObjectPrimitive } from "@temelj/value";
import * as z from "zod";

import type { HelperDeclareSpec, HelperDelegate } from "../types";
import { createHelperZod } from "../zod_helper_builder";

export function getObjectHelpers(): HelperDeclareSpec {
  return {
    object: createHelperZod()
      .hash(z.record(z.string(), z.any()))
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
