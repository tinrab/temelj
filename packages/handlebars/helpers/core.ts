import type { Registry } from "../registry.ts";
import type { HelperDeclareSpec } from "../types.ts";

export function getCoreHelpers(registry: Registry): HelperDeclareSpec {
  return {
    set: (context) => {
      if (context.data === undefined) {
        context.data = {};
      }
      for (const [k, v] of Object.entries(context.hash)) {
        context.data[k] = v;
      }
    },
    setRoot: (context) => {
      if (context.data === undefined) {
        context.data = {};
      }
      if (context.data.root === undefined) {
        context.data.root = {};
      }
      for (const [k, v] of Object.entries(context.hash)) {
        context.data.root[k] = v;
      }
    },
    partial: (path: string, options) => {
      let partial = registry.partials[path];
      if (typeof partial === "string") {
        partial = registry.compile(partial) as (options: unknown) => string;
      }
      if (typeof partial !== "function") {
        throw new Error(`Partial "${path}" not found`);
      }
      return partial(options.hash);
    },
    render: (template: string, options) => {
      const partial = registry.compile(template) as (
        options: unknown,
      ) => string;
      return partial(options.hash);
    },
  };
}
