const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export class Base64UrlError extends TypeError {
  constructor(message: string, context?: Function) {
    super(message);
    this.name = "Base64UrlError";

    if (Error.captureStackTrace !== undefined) {
      Error.captureStackTrace(this, context ?? this.constructor);
    }
  }

  static invalidValue(this: void): never {
    throw new Base64UrlError("Base64URL value is invalid", Base64UrlError.invalidValue);
  }
}

/** Encodes bytes as standard Base64. */
export function encodeBase64(value: Uint8Array): string {
  if ("toBase64" in value) {
    return value.toBase64();
  }
  return btoa(bytesToBinary(value));
}

/** Decodes standard Base64 into bytes. */
export function decodeBase64(value: string): Uint8Array {
  if ("fromBase64" in Uint8Array) {
    return Uint8Array.fromBase64(value);
  }
  return binaryToBytes(atob(value));
}

/** Encodes UTF-8 text as standard Base64. */
export function encodeBase64String(value: string): string {
  return encodeBase64(new TextEncoder().encode(value));
}

/** Decodes standard Base64 into UTF-8 text. */
export function decodeBase64String(value: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64(value));
}

/** Encodes bytes as unpadded Base64URL. */
export function encodeBase64Url(value: Uint8Array): string {
  if ("toBase64" in value) {
    return value.toBase64({ alphabet: "base64url", omitPadding: true });
  }
  return encodeBase64(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** Decodes unpadded or padded Base64URL into bytes. */
export function decodeBase64Url(value: string): Uint8Array {
  if (value.length % 4 === 1) {
    Base64UrlError.invalidValue();
  }
  for (const character of value) {
    if (character !== "=" && !BASE64URL_ALPHABET.includes(character)) {
      Base64UrlError.invalidValue();
    }
  }
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  if ("fromBase64" in Uint8Array) {
    return Uint8Array.fromBase64(`${value}${padding}`, { alphabet: "base64url" });
  }
  return decodeBase64(`${base64}${padding}`);
}

/** Encodes UTF-8 text as unpadded Base64URL. */
export function encodeBase64UrlString(value: string): string {
  return encodeBase64Url(new TextEncoder().encode(value));
}

/** Decodes unpadded or padded Base64URL into UTF-8 text. */
export function decodeBase64UrlString(value: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64Url(value));
}

function bytesToBinary(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }
  return binary;
}

function binaryToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index++) {
    bytes[index] = value.charCodeAt(index);
  }
  return bytes;
}
