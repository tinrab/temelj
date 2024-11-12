export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonObject
  | Array<JsonValue>;

export type JsonObject = { [key: string]: JsonValue };

export type PrimitiveValue =
  | string
  | boolean
  | number
  | bigint
  | symbol
  | null
  | undefined;

export type PrimitiveObject = { [key: string]: PrimitiveValue };
