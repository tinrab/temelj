import { isString } from "@temelj/value";

import { javascriptChildren, nodeValue, type JavaScriptNode } from "./javascript-ast.ts";

type CompileName =
  | "Content"
  | "Layout"
  | "ReferenceError"
  | "_props"
  | "_components"
  | "_createContent"
  | "_Fragment"
  | "_jsx"
  | "_jsxs"
  | "_jsxDEV"
  | "_missingReference"
  | "_provideComponents"
  | "_resolveMdxImport"
  | `__mdxModule${number}`
  | `__mdxStar${number}`
  | `__mdxIgnored${number}`;

/** Reserves authored identifiers before assigning stable names to generated bindings. */
export class CompileNames {
  readonly #used = new Set<string>();
  readonly #generated = new Map<CompileName, string>();

  public reserve(name: string): void {
    this.#used.add(name);
  }

  public reserveJavaScript(node: JavaScriptNode): void {
    if (node.type === "Identifier" || node.type === "JSXIdentifier") {
      const name = nodeValue(node, "name");

      if (isString(name)) {
        this.reserve(name);
      }
    }

    for (const child of javascriptChildren(node)) {
      this.reserveJavaScript(child);
    }
  }

  public get(preferred: CompileName): string {
    const existing = this.#generated.get(preferred);

    if (existing !== undefined) {
      return existing;
    }

    let name: string = preferred;
    let suffix = 0;

    while (this.#used.has(name)) {
      name = `${preferred}${++suffix}`;
    }

    this.#used.add(name);
    this.#generated.set(preferred, name);

    return name;
  }
}
