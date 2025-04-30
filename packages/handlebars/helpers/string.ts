import { z } from "zod";
import {
  capitalize,
  toCamelCase,
  toKebabCase,
  toPascalCase,
  toSnakeCase,
  toTitleCase,
} from "@temelj/string";

import type { HelperDeclareSpec } from "./types.ts";
import { createHelperZod } from "../zod_helper_builder.ts";

export function getStringHelpers(): HelperDeclareSpec {
  return {
    camelCase: (s: string) => toCamelCase(s),
    snakeCase: (s: string) => toSnakeCase(s),
    pascalCase: (s: string) => toPascalCase(s),
    titleCase: (s: string) => toTitleCase(s),
    kebabCase: (s: string) => toKebabCase(s),
    capitalize: (s: string) => capitalize(s),

    upperCase: (s: string) => s.toUpperCase(),
    lowerCase: (s: string) => s.toLowerCase(),

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
