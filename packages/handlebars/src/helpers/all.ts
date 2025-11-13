import type { Registry } from "../registry";
import { getArrayHelpers } from "./array";
import { getCoreHelpers } from "./core";
import { getObjectHelpers } from "./object";
import { getStringHelpers } from "./string";
import type { HelperDeclareSpec } from "../types";
import { getValueHelpers } from "./value";

export function getHelpers(registry: Registry): HelperDeclareSpec {
  return {
    ...getArrayHelpers(registry),
    ...getCoreHelpers(registry),
    ...getObjectHelpers(),
    ...getStringHelpers(),
    ...getValueHelpers(),
  };
}
