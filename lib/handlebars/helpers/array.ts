import { deepEquals } from "../../value/ops.ts";
import type { HelperDeclareSpec } from "./types.ts";

export function getArrayHelpers(): HelperDeclareSpec {
  return {
    "array": (...args: unknown[]): unknown[] => args.slice(0, -1),
    "arrayItemAt": (array: unknown[], index: number): unknown => array[index],
    "arrayContains": (array: unknown[], item: unknown): boolean =>
      array.findIndex((value) => deepEquals(value, item)) !== -1,
    "arrayJoin": (array: unknown[], separator: string): string =>
      array.map((item) => String(item)).join(separator),
  };
}
