import type { DirectiveAttributeSyntax } from "./block-syntax.ts";

const attributePattern =
  /([A-Za-z_:][\w:.-]*)(?:=(?:"([^"]*)"|'([^']*)'|([^\s]+)))?|([.#])([\w-]+)/gu;

/**
 * Parses directive attributes with unique names. Like the directive syntax
 * extension, classes accumulate and any other repeated name keeps its last value.
 */
export function parseDirectiveAttributes(source: string): readonly DirectiveAttributeSyntax[] {
  const values = new Map<string, string>();

  for (const match of source.matchAll(attributePattern)) {
    const shortcut = match[5];
    const name = shortcut === "#" ? "id" : shortcut === "." ? "class" : match[1];
    const value = shortcut === undefined ? (match[2] ?? match[3] ?? match[4] ?? "") : match[6];
    const previous = values.get(name);

    values.set(
      name,
      name === "class" && previous !== undefined && previous.length > 0
        ? `${previous} ${value}`
        : value,
    );
  }

  return [...values].map(([name, value]) => ({ name, value }));
}
