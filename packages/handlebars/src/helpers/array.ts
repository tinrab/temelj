import type { JsonValue } from "@temelj/value";

import { deepEquals } from "@temelj/value";

import type { Registry } from "../registry";
import type { HelperDeclareSpec } from "../types";

import { createHelper, helperSchema as s } from "../helper_builder";

export function getArrayHelpers(registry: Registry): HelperDeclareSpec {
  return {
    array: (...args: unknown[]): unknown[] => args.slice(0, -1),
    arrayItemAt: createHelper()
      .params(s.array(), s.number())
      .handle(([array, index]) => array[index]),
    arrayContains: (array: unknown[], item: unknown): boolean =>
      array.findIndex((value) => deepEquals(value, item)) !== -1,
    arrayJoin: (array: unknown[], separator: string): string =>
      array.map((item) => String(item)).join(separator),

    arrayFilter: createHelper()
      .params(s.unknown(), s.string())
      .handle(([inputArray, predicateTemplateString], ctx) => {
        if (!inputArray || !Array.isArray(inputArray)) {
          return [];
        }

        const compiledPredicate = registry.compile(predicateTemplateString);
        const filteredArray: JsonValue[] = [];

        for (const item of inputArray) {
          const predicateResult = compiledPredicate(item, {
            data: ctx.data, // Propagate the current data frame
          });

          if (String(predicateResult).toLowerCase().trim() === "true") {
            filteredArray.push(item);
          }
        }

        return filteredArray;
      }),
  };
}
