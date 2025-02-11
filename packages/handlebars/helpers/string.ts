import * as v from "valibot";
import {
  capitalize,
  toCamelCase,
  toPascalCase,
  toSnakeCase,
  toTitleCase,
} from "@temelj/string";

import type { HelperDeclareSpec } from "./types.ts";
import { createHelperValibot } from "../valibot_helper_builder.ts";

export function getStringHelpers(): HelperDeclareSpec {
  return {
    "camelCase": (s: string) => toCamelCase(s),
    "snakeCase": (s: string) => toSnakeCase(s),
    "pascalCase": (s: string) => toPascalCase(s),
    "titleCase": (s: string) => toTitleCase(s),
    "capitalize": (s: string) => capitalize(s),

    "upperCase": (s: string) => s.toUpperCase(),
    "lowerCase": (s: string) => s.toLowerCase(),

    "split": createHelperValibot()
      .params(v.string(), v.optional(v.string(), "/"))
      .handle(([s, separator]) => s.split(separator)),
    "splitPart": createHelperValibot()
      .params(v.string(), v.number(), v.optional(v.string(), "/"))
      .handle(
        ([path, index]) => {
          const parts = path.split("/");
          return parts[index];
        },
      ),
    "splitPartSegment": createHelperValibot().params(
      v.string(),
      v.number(),
      v.number(),
      v.optional(v.string(), "/"),
    ).handle(
      (
        [path, from, to, separator],
      ) => {
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
      },
    ),

    "join": (...values: unknown[]) => {
      return values.slice(0, -1).join("");
    },
  };
}
