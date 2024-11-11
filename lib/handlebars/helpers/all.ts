import type { Registry } from "../registry.ts";
import { getArrayHelpers } from "./array.ts";
import { getCoreHelpers } from "./core.ts";
import { getObjectHelpers } from "./object.ts";
import { getStringHelpers } from "./string.ts";
import type { HelperDeclareSpec } from "./types.ts";
import { getValueHelpers } from "./value.ts";

export function getHelpers(registry: Registry): HelperDeclareSpec {
  return {
    ...getArrayHelpers(),
    ...getCoreHelpers(registry),
    ...getObjectHelpers(),
    ...getStringHelpers(),
    ...getValueHelpers(),
  };
}
