import { isObjectPrimitive } from "@temelj/value";
import { z } from "zod";

import type { HelperDeclareSpec, HelperDelegate } from "../types.ts";
import { createHelperZod } from "../zod_helper_builder.ts";

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
      for (const key of keys) {
        if (key in obj) {
          result[key] = obj[key];
        }
      }
      return result;
    }) as unknown as HelperDelegate,
  };
}
