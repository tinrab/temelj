import { deepEquals } from "@temelj/value";
import { z } from "zod";

import type { HelperDeclareSpec } from "../types.ts";
import { createHelperZod } from "../zod_helper_builder.ts";
import type { Registry } from "../registry.ts";
import type { JsonValue } from "../../value/types.ts";

export function getArrayHelpers(registry: Registry): HelperDeclareSpec {
  return {
    array: (...args: unknown[]): unknown[] => args.slice(0, -1),
    arrayItemAt: createHelperZod()
      .params(z.array(z.any()), z.number())
      .handle(([array, index]) => array[index]),
    arrayContains: (array: unknown[], item: unknown): boolean =>
      array.findIndex((value) => deepEquals(value, item)) !== -1,
    arrayJoin: (array: unknown[], separator: string): string =>
      array.map((item) => String(item)).join(separator),

    arrayFilter: createHelperZod()
      .params(z.array(z.any()), z.string())
      .handle(
        ([inputArray, predicateTemplateString], ctx) => {
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
        },
      ),
  };
}
