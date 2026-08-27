export interface JsxReferenceContext {
  readonly inScope: ReadonlySet<string>;
  readonly missingReferences: Map<string, boolean>;
  readonly referencedComponents: Set<string>;
}

export interface ResolvedJsxName {
  readonly base: string | undefined;
  readonly expression: string;
  readonly name: string | undefined;
}

export function resolveJsxName(name: string | undefined): ResolvedJsxName {
  if (name === undefined) {
    return { base: undefined, expression: "_Fragment", name };
  }
  if (name.includes(":")) {
    return { base: undefined, expression: JSON.stringify(name), name };
  }
  if (/^[a-z]/u.test(name) || name.includes("-")) {
    return { base: undefined, expression: JSON.stringify(name), name };
  }
  return { base: name.split(".", 1)[0], expression: name, name };
}

export function recordJsxReference(resolved: ResolvedJsxName, context: JsxReferenceContext): void {
  const { base, name } = resolved;
  if (base === undefined || name === undefined) {
    return;
  }
  if (!context.inScope.has(base)) {
    context.referencedComponents.add(base);
    if (!context.missingReferences.has(base)) {
      context.missingReferences.set(base, name === base);
    }
  }
  if (name !== base) {
    context.missingReferences.set(name, true);
  }
}
