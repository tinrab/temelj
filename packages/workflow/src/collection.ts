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
export type DefinedProperties<T> = {
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

/** Returns an object containing one property only when the value is defined. */
export function optionalProperty<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  if (value === undefined) return {};

  // SAFETY: The object has one of the permitted keys with its corresponding TValue; other keys remain optional.
  return { [key]: value } as Partial<Record<TKey, TValue>>;
}

/** Returns sorted string values from a set. */
export function sortedStringSet(values: ReadonlySet<string>): readonly string[] {
  return [...values].sort();
}

/** Returns an object containing a sorted string set only when the set is not empty. */
export function optionalSortedStringSetProperty<TKey extends string>(
  key: TKey,
  values: ReadonlySet<string>,
): Partial<Record<TKey, readonly string[]>> {
  return optionalProperty(key, values.size === 0 ? undefined : sortedStringSet(values));
}
