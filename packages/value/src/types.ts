/**
 * A valid JSON value.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonObject
  | Array<JsonValue>;

/**
 * A valid JSON object.
 */
export type JsonObject = { [key: string]: JsonValue };

/**
 * A primitive JavaScript value.
 */
export type PrimitiveValue =
  | Primitive
  | PrimitiveObject
  | Array<PrimitiveValue>;

/**
 * A JavaScript value that is not an object and has no methods or properties.
 */
export type Primitive =
  | string
  | boolean
  | number
  | bigint
  | symbol
  | null
  | undefined;

/**
 * A plain JavaScript object with primitive values.
 */
export type PrimitiveObject = { [key: string]: PrimitiveValue };
