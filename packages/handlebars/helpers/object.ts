import { isObjectPrimitive } from "@temelj/value";
import * as v from "valibot";

import type { HelperDeclareSpec, HelperDelegate } from "./types.ts";
import { createHelperValibot } from "../valibot_helper_builder.ts";

export function getObjectHelpers(): HelperDeclareSpec {
  return {
    "object": createHelperValibot()
      .hash(v.record(v.string(), v.any()))
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
