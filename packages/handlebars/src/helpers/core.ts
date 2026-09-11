import { isString } from "@temelj/value";

import type { Registry } from "../registry";
import type { HelperDeclareSpec } from "../types";

import { HandlebarsHelperError } from "../helper_builder";

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

      if (isString(partial)) {
        partial = registry.compile(partial);
      }

      if (partial === undefined) {
        HandlebarsHelperError.partialNotFound(path);
      }

      return partial(options.hash);
    },
    render: (template: string, options) => {
      const partial = registry.compile(template);

      return partial(options.hash);
    },
  };
}
