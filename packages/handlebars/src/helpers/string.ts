import { z } from "zod";
import {
  capitalize,
  toCamelCase,
  toKebabCase,
  toPascalCase,
  toSnakeCase,
  toTitleCase,
} from "@temelj/string";

import { createHelperZod } from "../zod_helper_builder";
import type { HelperDeclareSpec } from "../types";

export function getStringHelpers(): HelperDeclareSpec {
  return {
    camelCase: createHelperZod()
      .params(z.string())
      .handle(([s]) => toCamelCase(s)),
    snakeCase: createHelperZod()
      .params(z.string())
      .handle(([s]) => toSnakeCase(s)),
    pascalCase: createHelperZod()
      .params(z.string())
      .handle(([s]) => toPascalCase(s)),
    titleCase: createHelperZod()
      .params(z.string())
      .handle(([s]) => toTitleCase(s)),
    kebabCase: createHelperZod()
      .params(z.string())
      .handle(([s]) => toKebabCase(s)),

    capitalize: createHelperZod()
      .params(z.string())
      .handle(([s]) => capitalize(s)),
    upperCase: createHelperZod()
      .params(z.string())
      .handle(([s]) => s.toUpperCase()),
    lowerCase: createHelperZod()
      .params(z.string())
      .handle(([s]) => s.toLowerCase()),

    split: createHelperZod()
      .params(z.string(), z.optional(z.string()).default("/"))
      .handle(([s, separator]) => s.split(separator)),
    splitPart: createHelperZod()
      .params(z.string(), z.number(), z.optional(z.string()).default("/"))
      .handle(([path, index]) => {
        const parts = path.split("/");
        return parts[index];
      }),
    splitPartSegment: createHelperZod()
      .params(
        z.string(),
        z.number(),
        z.number(),
        z.optional(z.string()).default("/"),
      )
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
