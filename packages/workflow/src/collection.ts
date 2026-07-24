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

/** Returns a copy of an object without properties whose value is undefined. */
export function omitUndefined(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

/** Returns an object containing one property only when the value is defined. */
export function optionalProperty<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
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
  return values.size === 0
    ? {}
    : ({ [key]: sortedStringSet(values) } as Record<TKey, readonly string[]>);
}
