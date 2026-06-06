import {
  capitalize,
  toCamelCase,
  toKebabCase,
  toPascalCase,
  toSnakeCase,
  toTitleCase,
} from "@temelj/string";

import type { HelperDeclareSpec } from "../types";

import { createHelper, helperSchema as s } from "../helper_builder";

export function getStringHelpers(): HelperDeclareSpec {
  return {
    camelCase: createHelper()
      .params(s.string())
      .handle(([s]) => toCamelCase(s)),
    snakeCase: createHelper()
      .params(s.string())
      .handle(([s]) => toSnakeCase(s)),
    pascalCase: createHelper()
      .params(s.string())
      .handle(([s]) => toPascalCase(s)),
    titleCase: createHelper()
      .params(s.string())
      .handle(([s]) => toTitleCase(s)),
    kebabCase: createHelper()
      .params(s.string())
      .handle(([s]) => toKebabCase(s)),

    capitalize: createHelper()
      .params(s.string())
      .handle(([s]) => capitalize(s)),
    upperCase: createHelper()
      .params(s.string())
      .handle(([s]) => s.toUpperCase()),
    lowerCase: createHelper()
      .params(s.string())
      .handle(([s]) => s.toLowerCase()),

    split: createHelper()
      .params(s.string(), s.defaulted(s.string(), "/"))
      .handle(([s, separator]) => s.split(separator)),
    splitPart: createHelper()
      .params(s.string(), s.number(), s.defaulted(s.string(), "/"))
      .handle(([path, index]) => {
        const parts = path.split("/");
        return parts[index];
      }),
    splitPartSegment: createHelper()
      .params(s.string(), s.number(), s.number(), s.defaulted(s.string(), "/"))
      .handle(([path, from, to, separator]) => {
        const parts = path.split(separator);
        let result = "";
        const n = Math.min(to + 1, parts.length);
        for (let i = from; i < n; i++) {
          const part = parts[i];
          result += part;
          if (i < n - 1) {
            result += separator;
          }
        }
        return result;
      }),

    join: (...values: unknown[]) => {
      return values.slice(0, -1).join("");
    },
  };
}
