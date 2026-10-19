import { isPlainObject } from "@temelj/value";

/** Returns whether a value matches one expected value or any value in an expected list. */
export function matchesOptionalValue<T>(value: T, expected: T | readonly T[]): boolean {
  return Array.isArray(expected) ? expected.includes(value) : Object.is(value, expected);
}

/** Returns the first item for each key while preserving input order. */
export function uniqueBy<T>(items: readonly T[], key: (item: T) => string): readonly T[] {
  const seen = new Set<string>();

  return items.filter((item) => {
    const itemKey = key(item);

    if (seen.has(itemKey)) {
      return false;
    }

    seen.add(itemKey);

    return true;
  });
}

/** Own record fields after removing undefined values. */
type DefinedProperties<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

/** Copies the defined own enumerable fields of a plain record. */
export function omitUndefined<T extends object>(value: T): DefinedProperties<T> {
  if (!isPlainObject(value)) throw new TypeError("Expected a plain record");
  const result = { ...value };

  for (const key of Reflect.ownKeys(result)) {
    const descriptor = Object.getOwnPropertyDescriptor(result, key);

    if (descriptor?.value === undefined) Reflect.deleteProperty(result, key);
  }

  // SAFETY: The copy retains each defined own record value; only keys containing undefined are removed.
  return result as DefinedProperties<T>;
}

export function limitItems<T>(items: readonly T[], limit: number | undefined): readonly T[] {
  if (limit === undefined) {
    return items;
  }

  return items.slice(0, limit);
}
