import { isObjectPrimitive } from "../../value/check.ts";
import type { HelperDeclareSpec, HelperDelegate } from "./types.ts";

export function getObjectHelpers(): HelperDeclareSpec {
  return {
    "objectIsEmpty": (obj: unknown) => {
      if (!isObjectPrimitive(obj)) {
        return true;
      }
      return Object.keys(obj).length === 0;
    },
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
