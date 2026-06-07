const ByteSize = {
  BOOLEAN: 4,
  NUMBER: 8,
  STRING_CODE_UNIT: 2,
} as const;

/**
 * Estimates the byte size of a JavaScript value.
 *
 * The result is a deterministic structural estimate, not an engine heap measurement.
 * Object property keys are counted with their values.
 * Circular object references are counted once.
 *
 * @param value The value to inspect.
 * @returns The estimated size in bytes.
 */
export function sizeOf(value: unknown): number {
  return sizeValue(value, new WeakSet<object>());
}

function sizeValue(value: unknown, seen: WeakSet<object>): number {
  switch (typeof value) {
    case "string":
      return value.length * ByteSize.STRING_CODE_UNIT;
    case "boolean":
      return ByteSize.BOOLEAN;
    case "number":
      return ByteSize.NUMBER;
    case "bigint":
      return sizeString(value.toString());
    case "symbol":
      return sizeSymbol(value);
    case "function":
      return sizeString(value.toString());
    case "object":
      return value === null ? 0 : sizeObject(value, seen);
    case "undefined":
      return 0;
  }
}

function sizeObject(value: object, seen: WeakSet<object>): number {
  if (seen.has(value)) {
    return 0;
  }
  seen.add(value);

  if (value instanceof ArrayBuffer) {
    return value.byteLength;
  }

  if (ArrayBuffer.isView(value)) {
    return value.byteLength;
  }

  if (value instanceof Date) {
    return ByteSize.NUMBER;
  }

  if (value instanceof RegExp) {
    return sizeString(value.toString());
  }

  if (value instanceof Map) {
    return sizeMap(value, seen);
  }

  if (value instanceof Set) {
    return sizeSet(value, seen);
  }

  if (Array.isArray(value)) {
    return sizeArray(value, seen);
  }

  return sizeProperties(value, seen);
}

function sizeMap(map: Map<unknown, unknown>, seen: WeakSet<object>): number {
  let bytes = 0;
  for (const [key, value] of map) {
    bytes += sizeValue(key, seen);
    bytes += sizeValue(value, seen);
  }
  return bytes;
}

function sizeSet(set: Set<unknown>, seen: WeakSet<object>): number {
  let bytes = 0;
  for (const value of set) {
    bytes += sizeValue(value, seen);
  }
  return bytes;
}

function sizeArray(array: readonly unknown[], seen: WeakSet<object>): number {
  let bytes = 0;
  for (const value of array) {
    bytes += sizeValue(value, seen);
  }
  return bytes;
}

function sizeProperties(value: object, seen: WeakSet<object>): number {
  let bytes = 0;
  for (const key of Reflect.ownKeys(value)) {
    if (!isEnumerable(value, key)) {
      continue;
    }

    bytes += sizeKey(key);
    bytes += sizeValue(readProperty(value, key), seen);
  }
  return bytes;
}

function isEnumerable(value: object, key: PropertyKey): boolean {
  return Object.prototype.propertyIsEnumerable.call(value, key);
}

function readProperty(value: object, key: PropertyKey): unknown {
  try {
    return value[key as keyof typeof value];
  } catch {
    return undefined;
  }
}

function sizeKey(key: PropertyKey): number {
  if (typeof key === "symbol") {
    return sizeSymbol(key);
  }
  return sizeString(String(key));
}

function sizeSymbol(symbol: symbol): number {
  const globalKey = Symbol.keyFor(symbol);
  if (globalKey !== undefined) {
    return sizeString(globalKey);
  }

  return sizeString(symbol.description ?? "");
}

function sizeString(value: string): number {
  return value.length * ByteSize.STRING_CODE_UNIT;
}
