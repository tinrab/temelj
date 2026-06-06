import { ss } from "@temelj/standard-schema";
import {
  capitalize,
  toCamelCase,
  toKebabCase,
  toPascalCase,
  toSnakeCase,
  toTitleCase,
} from "@temelj/string";

import type { HelperDeclareSpec } from "../types";

import { createHelper } from "../helper_builder";

export function getStringHelpers(): HelperDeclareSpec {
  return {
    camelCase: createHelper()
      .params(ss.string())
      .handle(([s]) => toCamelCase(s)),
    snakeCase: createHelper()
      .params(ss.string())
      .handle(([s]) => toSnakeCase(s)),
    pascalCase: createHelper()
      .params(ss.string())
      .handle(([s]) => toPascalCase(s)),
    titleCase: createHelper()
      .params(ss.string())
      .handle(([s]) => toTitleCase(s)),
    kebabCase: createHelper()
      .params(ss.string())
      .handle(([s]) => toKebabCase(s)),

    capitalize: createHelper()
      .params(ss.string())
      .handle(([s]) => capitalize(s)),
    upperCase: createHelper()
      .params(ss.string())
      .handle(([s]) => s.toUpperCase()),
    lowerCase: createHelper()
      .params(ss.string())
      .handle(([s]) => s.toLowerCase()),

    split: createHelper()
      .params(ss.string(), ss.defaulted(ss.string(), "/"))
      .handle(([s, separator]) => s.split(separator)),
    splitPart: createHelper()
      .params(ss.string(), ss.number(), ss.defaulted(ss.string(), "/"))
      .handle(([path, index]) => {
        const parts = path.split("/");
        return parts[index];
      }),
    splitPartSegment: createHelper()
      .params(ss.string(), ss.number(), ss.number(), ss.defaulted(ss.string(), "/"))
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
