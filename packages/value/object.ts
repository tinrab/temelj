export function convertMapToObject(value: object): object {
  if (value instanceof Map) {
    return Object.fromEntries(
      Array.from(value.entries(), ([k, v]) => [k, convertMapToObject(v)]),
    );
  }
  if (Array.isArray(value)) {
    return value.map((x) => convertMapToObject(x));
  }
  if (value?.constructor === Object) {
    const newObj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      newObj[k] = convertMapToObject(v);
    }
    return newObj;
  }
  return value;
}
