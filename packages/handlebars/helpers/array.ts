import { deepEquals } from "@temelj/value";
import { z } from "zod";

import type { HelperDeclareSpec } from "../types.ts";
import { createHelperZod } from "../zod_helper_builder.ts";

export function getArrayHelpers(): HelperDeclareSpec {
  return {
    array: (...args: unknown[]): unknown[] => args.slice(0, -1),
    arrayItemAt: createHelperZod()
      .params(z.array(z.any()), z.number())
      .handle(([array, index]) => array[index]),
    arrayContains: (array: unknown[], item: unknown): boolean =>
      array.findIndex((value) => deepEquals(value, item)) !== -1,
    arrayJoin: (array: unknown[], separator: string): string =>
      array.map((item) => String(item)).join(separator),
  };
}
