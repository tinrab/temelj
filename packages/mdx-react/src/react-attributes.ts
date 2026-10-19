import type { HtmlAttributes } from "@temelj/mdx";

import { isHtmlAttributeList } from "@temelj/mdx";
import { isString } from "@temelj/value";
import { find, hastToReact, html, svg } from "property-information";
import styleToJs from "style-to-js";

export type ReactAttributes = Readonly<
  Record<string, boolean | number | string | Readonly<Record<string, string>>>
>;

/** Converts HTML attribute names and CSS strings to React props. */
export function reactAttributes(attributes: HtmlAttributes, inSvg: boolean): ReactAttributes {
  const schema = inSvg ? svg : html;

  return Object.fromEntries(
    Object.entries(attributes).map(([name, value]) => {
      const information = find(schema, name);

      const reactName =
        information.attribute.startsWith("aria-") || information.attribute.startsWith("data-")
          ? information.attribute
          : (hastToReact[information.property] ?? information.property);

      const serialized = isHtmlAttributeList(value) ? value.join(" ") : value;

      return [
        reactName,
        reactName === "style" && isString(serialized)
          ? styleToJs(serialized, { reactCompat: true })
          : serialized,
      ];
    }),
  );
}
