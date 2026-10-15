import { createHash } from "node:crypto";
import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";

interface SemanticElement {
  readonly tag: string;
  readonly attributes: readonly (readonly [string, string])[];
  readonly children: readonly SemanticNode[];
}

type SemanticNode = string | SemanticElement;

const blockWhitespace = new Set([
  "#document-fragment",
  "ul",
  "ol",
  "blockquote",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
]);

const presentation = new Set(["class", "style", "align", "data-lang", "data-meta"]);

/** Compare rendered structure and text, retaining captions, destinations, and checkbox states. */
export function semanticHtml(html: string): string {
  const root = parseFragment(html);

  return JSON.stringify(children(root.childNodes, root.nodeName, false));
}

export function outputDigest(html: string): string {
  return createHash("sha256").update(html).digest("hex");
}

function children(
  nodes: readonly DefaultTreeAdapterTypes.ChildNode[],
  parent: string,
  preformatted: boolean,
): SemanticNode[] {
  const result: SemanticNode[] = [];

  for (const node of nodes) {
    if ("value" in node) {
      // Ignore block indentation, but retain spaces inside prose and all code content.
      if (!preformatted && blockWhitespace.has(parent) && /^\s*$/u.test(node.value)) {
        continue;
      }

      // Renderers disagree on adding one final code-line ending.
      const value = preformatted && parent === "code" ? node.value.replace(/\n$/u, "") : node.value;
      result.push(value);
    } else if ("tagName" in node) {
      result.push({
        tag: node.tagName,
        attributes: node.attrs
          .flatMap((attribute): (readonly [string, string])[] =>
            presentation.has(attribute.name) ? [] : [[attribute.name, attribute.value]],
          )
          .sort(([left], [right]) => left.localeCompare(right)),
        children: children(node.childNodes, node.tagName, preformatted || node.tagName === "pre"),
      });
    }
  }

  return result;
}
