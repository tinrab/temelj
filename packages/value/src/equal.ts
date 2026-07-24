type SeenPairs = WeakMap<object, WeakSet<object>>;

const REACT_OWNER_KEYS = new Set<PropertyKey>(["_owner", "__v", "__o"]);

/**
 * Compares two values for deep equality.
 *
 * @param a The first value to compare.
 * @param b The second value to compare.
 * @returns `true` if the values are deeply equal, `false` otherwise.
 */
export function deepEquals(a: unknown, b: unknown): boolean {
  try {
    return deepEqualsObject(a, b);
  } catch (error) {
    if (error instanceof Error && /stack|recursion/i.test(error.message)) {
      return false;
    }
    throw error;
  }
}

function deepEqualsObject(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (left === null || right === null) {
    return false;
  }
  if (typeof left !== "object" || typeof right !== "object") {
    return left !== left && right !== right;
  }

  const leftConstructor = getConstructor(left);
  if (leftConstructor !== getConstructor(right)) {
    return false;
  }

  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    for (let index = left.length; index-- !== 0;) {
      if (!deepEqualsObject(left[index], right[index])) {
        return false;
      }
    }
    return true;
  }
  if (Array.isArray(right)) {
    return false;
  }

  if (
    left instanceof ArrayBuffer ||
    right instanceof ArrayBuffer ||
    left instanceof DataView ||
    right instanceof DataView ||
    left instanceof Map ||
    right instanceof Map ||
    left instanceof Set ||
    right instanceof Set ||
    left instanceof Temporal.Instant ||
    right instanceof Temporal.Instant ||
    left instanceof Temporal.Duration ||
    right instanceof Temporal.Duration ||
    isTemporalObject(left) ||
    isTemporalObject(right) ||
    hasEnumerableSymbols(left) ||
    hasEnumerableSymbols(right)
  ) {
    return deepEqualsGranular(left, right);
  }

  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
  }
  if (ArrayBuffer.isView(left) || ArrayBuffer.isView(right)) {
    return (
      ArrayBuffer.isView(left) &&
      ArrayBuffer.isView(right) &&
      deepEqualsArrayBufferViews(left, right)
    );
  }
  if (leftConstructor === RegExp) {
    return (
      left instanceof RegExp &&
      right instanceof RegExp &&
      left.source === right.source &&
      left.flags === right.flags
    );
  }

  const valueOfResult = deepEqualsValueOf(left, right);
  if (valueOfResult !== undefined) {
    return valueOfResult;
  }
  const toStringResult = deepEqualsToString(left, right);
  if (toStringResult !== undefined) {
    return toStringResult;
  }
  if (isElement(left)) {
    return false;
  }

  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) {
    return false;
  }
  for (let index = keys.length; index-- !== 0;) {
    if (!Object.prototype.hasOwnProperty.call(right, keys[index])) {
      return false;
    }
  }
  for (let index = keys.length; index-- !== 0;) {
    const key = keys[index];
    if (shouldSkipOwnerKey(left, key)) {
      continue;
    }
    if (!deepEqualsObject(left[key as keyof typeof left], right[key as keyof typeof right])) {
      return false;
    }
  }
  return true;
}

function deepEqualsGranular(left: unknown, right: unknown): boolean {
  return deepEqualsValue(left, right, new WeakMap<object, WeakSet<object>>());
}

function deepEqualsValue(left: unknown, right: unknown, seen: SeenPairs): boolean {
  if (left === right) {
    return true;
  }
  if (left === null || right === null) {
    return false;
  }
  if (typeof left !== "object" || typeof right !== "object") {
    return left !== left && right !== right;
  }

  const leftConstructor = getConstructor(left);
  if (leftConstructor !== getConstructor(right)) {
    return false;
  }
  if (hasSeenPair(left, right, seen)) {
    return false;
  }
  markSeenPair(left, right, seen);

  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && deepEqualsArray(left, right, seen);
  }
  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
  }
  if (left instanceof Temporal.Instant || right instanceof Temporal.Instant) {
    return (
      left instanceof Temporal.Instant &&
      right instanceof Temporal.Instant &&
      Temporal.Instant.compare(left, right) === 0
    );
  }
  if (left instanceof Temporal.Duration || right instanceof Temporal.Duration) {
    return (
      left instanceof Temporal.Duration &&
      right instanceof Temporal.Duration &&
      temporalDurationsEqual(left, right)
    );
  }
  if (isTemporalObject(left) || isTemporalObject(right)) {
    return isTemporalObject(left) && isTemporalObject(right) && temporalEquals(left, right);
  }
  if (left instanceof RegExp || right instanceof RegExp) {
    return (
      left instanceof RegExp &&
      right instanceof RegExp &&
      left.source === right.source &&
      left.flags === right.flags
    );
  }
  if (left instanceof ArrayBuffer || right instanceof ArrayBuffer) {
    return (
      left instanceof ArrayBuffer &&
      right instanceof ArrayBuffer &&
      deepEqualsBytes(new Uint8Array(left), new Uint8Array(right))
    );
  }
  if (ArrayBuffer.isView(left) || ArrayBuffer.isView(right)) {
    return (
      ArrayBuffer.isView(left) &&
      ArrayBuffer.isView(right) &&
      deepEqualsArrayBufferViews(left, right)
    );
  }
  if (left instanceof Map || right instanceof Map) {
    return left instanceof Map && right instanceof Map && deepEqualsMap(left, right, seen);
  }
  if (left instanceof Set || right instanceof Set) {
    return left instanceof Set && right instanceof Set && deepEqualsSet(left, right, seen);
  }

  const valueOfResult = deepEqualsValueOf(left, right);
  if (valueOfResult !== undefined) {
    return valueOfResult;
  }
  const toStringResult = deepEqualsToString(left, right);
  if (toStringResult !== undefined) {
    return toStringResult;
  }
  if (isElement(left)) {
    return false;
  }
  return deepEqualsProperties(left, right, seen);
}

function temporalDurationsEqual(left: Temporal.Duration, right: Temporal.Duration): boolean {
  try {
    return Temporal.Duration.compare(left, right) === 0;
  } catch (error) {
    if (!(error instanceof RangeError)) {
      throw error;
    }
    return (
      left.years === right.years &&
      left.months === right.months &&
      left.weeks === right.weeks &&
      left.days === right.days &&
      left.hours === right.hours &&
      left.minutes === right.minutes &&
      left.seconds === right.seconds &&
      left.milliseconds === right.milliseconds &&
      left.microseconds === right.microseconds &&
      left.nanoseconds === right.nanoseconds
    );
  }
}

function getConstructor(value: object): unknown {
  return (value as { readonly constructor?: unknown }).constructor;
}

function hasEnumerableSymbols(value: object): boolean {
  return Object.getOwnPropertySymbols(value).some((key) =>
    Object.prototype.propertyIsEnumerable.call(value, key),
  );
}

function hasSeenPair(left: object, right: object, seen: SeenPairs): boolean {
  return seen.get(left)?.has(right) === true;
}

function markSeenPair(left: object, right: object, seen: SeenPairs): void {
  const existing = seen.get(left);
  if (existing !== undefined) {
    existing.add(right);
    return;
  }
  seen.set(left, new WeakSet<object>([right]));
}

function deepEqualsArray(
  left: readonly unknown[],
  right: readonly unknown[],
  seen: SeenPairs,
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => deepEqualsValue(value, right[index], seen))
  );
}

function isTemporalObject(value: unknown): value is { equals(other: unknown): boolean } {
  const constructorName =
    typeof value === "object" && value !== null ? getConstructorName(value) : undefined;
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { readonly equals?: unknown }).equals === "function" &&
    constructorName !== undefined &&
    constructorName.startsWith("Temporal.")
  );
}

function getConstructorName(value: object): string | undefined {
  const name = (getConstructor(value) as { readonly name?: unknown } | undefined)?.name;
  return typeof name === "string" ? name : undefined;
}

function temporalEquals(
  left: { equals(other: unknown): boolean },
  right: { equals(other: unknown): boolean },
): boolean {
  try {
    return left.equals(right);
  } catch {
    return false;
  }
}

function deepEqualsBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
  );
}

function deepEqualsArrayBufferViews(left: ArrayBufferView, right: ArrayBufferView): boolean {
  if (getConstructor(left) !== getConstructor(right) || left.byteLength !== right.byteLength) {
    return false;
  }
  return deepEqualsBytes(
    new Uint8Array(left.buffer, left.byteOffset, left.byteLength),
    new Uint8Array(right.buffer, right.byteOffset, right.byteLength),
  );
}

function deepEqualsMap(
  left: ReadonlyMap<unknown, unknown>,
  right: ReadonlyMap<unknown, unknown>,
  seen: SeenPairs,
): boolean {
  if (left.size !== right.size) {
    return false;
  }
  const rightEntries = [...right.entries()];
  return [...left.entries()].every(([leftKey, leftValue], index) => {
    const rightEntry = rightEntries[index];
    return (
      rightEntry !== undefined &&
      deepEqualsValue(leftKey, rightEntry[0], seen) &&
      deepEqualsValue(leftValue, rightEntry[1], seen)
    );
  });
}

function deepEqualsSet(
  left: ReadonlySet<unknown>,
  right: ReadonlySet<unknown>,
  seen: SeenPairs,
): boolean {
  if (left.size !== right.size) {
    return false;
  }
  const rightValues = [...right.values()];
  return [...left.values()].every((value, index) =>
    deepEqualsValue(value, rightValues[index], seen),
  );
}

function deepEqualsValueOf(left: object, right: object): boolean | undefined {
  const leftValueOf = (left as { readonly valueOf?: unknown }).valueOf;
  const rightValueOf = (right as { readonly valueOf?: unknown }).valueOf;
  if (
    leftValueOf === Object.prototype.valueOf ||
    typeof leftValueOf !== "function" ||
    typeof rightValueOf !== "function"
  ) {
    return undefined;
  }
  return leftValueOf.call(left) === rightValueOf.call(right);
}

function deepEqualsToString(left: object, right: object): boolean | undefined {
  const leftToString = (left as { readonly toString?: unknown }).toString;
  const rightToString = (right as { readonly toString?: unknown }).toString;
  if (
    leftToString === Object.prototype.toString ||
    typeof leftToString !== "function" ||
    typeof rightToString !== "function"
  ) {
    return undefined;
  }
  return leftToString.call(left) === rightToString.call(right);
}

function isElement(value: object): boolean {
  return typeof Element !== "undefined" && value instanceof Element;
}

function deepEqualsProperties(left: object, right: object, seen: SeenPairs): boolean {
  const leftKeys = enumerableKeys(left);
  if (leftKeys.length !== enumerableKeys(right).length) {
    return false;
  }
  for (const key of leftKeys) {
    if (!Object.prototype.propertyIsEnumerable.call(right, key)) {
      return false;
    }
  }
  for (const key of leftKeys) {
    if (shouldSkipOwnerKey(left, key)) {
      continue;
    }
    if (!deepEqualsValue(left[key as keyof typeof left], right[key as keyof typeof right], seen)) {
      return false;
    }
  }
  return true;
}

function enumerableKeys(value: object): PropertyKey[] {
  return [
    ...Object.keys(value),
    ...Object.getOwnPropertySymbols(value).filter((key) =>
      Object.prototype.propertyIsEnumerable.call(value, key),
    ),
  ];
}

function shouldSkipOwnerKey(value: object, key: PropertyKey): boolean {
  return REACT_OWNER_KEYS.has(key) && "$$typeof" in value;
}
