import * as v from "valibot";
import { deepEquals } from "@temelj/value";

import type { HelperDeclareSpec } from "./types.ts";
import { createHelperValibot } from "../valibot_helper_builder.ts";

export function getArrayHelpers(): HelperDeclareSpec {
  return {
    "array": (...args: unknown[]): unknown[] => args.slice(0, -1),
    "arrayItemAt": createHelperValibot()
      .params(v.array(v.any()), v.number())
      .handle(([array, index]) => array[index]),
    "arrayContains": (array: unknown[], item: unknown): boolean =>
      array.findIndex((value) => deepEquals(value, item)) !== -1,
    "arrayJoin": (array: unknown[], separator: string): string =>
      array.map((item) => String(item)).join(separator),
  };
}
