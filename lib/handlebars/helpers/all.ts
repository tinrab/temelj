import type { Registry } from "~/handlebars/registry.ts";
import { getArrayHelpers } from "~/handlebars/helpers/array.ts";
import { getCoreHelpers } from "~/handlebars/helpers/core.ts";
import { getObjectHelpers } from "~/handlebars/helpers/object.ts";
import { getStringHelpers } from "~/handlebars/helpers/string.ts";
import type { HelperDeclareSpec } from "~/handlebars/helpers/types.ts";
import { getValueHelpers } from "~/handlebars/helpers/value.ts";

export function getHelpers(registry: Registry): HelperDeclareSpec {
  return {
    ...getArrayHelpers(),
    ...getCoreHelpers(registry),
    ...getObjectHelpers(),
    ...getStringHelpers(),
    ...getValueHelpers(),
  };
}
