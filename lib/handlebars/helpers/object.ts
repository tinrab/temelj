import { z } from "zod";

import { isObjectPrimitive } from "../../value/check.ts";
import { createHelper } from "../utility.ts";
import type { HelperDeclareSpec, HelperDelegate } from "./types.ts";

export function getObjectHelpers(): HelperDeclareSpec {
  return {
    "object": createHelper()
      .hash(z.record(z.string(), z.any()))
      .handle((hash) => hash),
    "objectPick": ((obj: unknown, ...keys: string[]) => {
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
