import type { Registry } from "../registry.ts";
import type { HelperDeclareSpec } from "../types.ts";

export function getCoreHelpers(registry: Registry): HelperDeclareSpec {
  return {
    "set": (context) => {
      for (const [k, v] of Object.entries(context.hash)) {
        context.data[k] = v;
      }
    },
    "partial": (path: string, options) => {
      let partial = registry.partials[path];
      if (typeof partial === "string") {
        partial = registry.compile(partial) as (options: unknown) => string;
      }
      if (typeof partial !== "function") {
        throw new Error(`Partial "${path}" not found`);
      }
      return partial(options.hash);
    },
  };
}
