import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import * as cookieUtility from "tough-cookie";

/**
 * A HTTP cookie.
 */
export interface Cookie {
  name: string;
  value: string;
  domain?: string;
  expires?: Date;
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  priority?: "low" | "medium" | "high";
  sameSite?: "strict" | "lax" | "none";
  secure?: boolean;
  partitioned?: boolean;
  extra?: Record<string, string>;
}

/**
 * Parses a cookie Set-Cookie header value into a Cookie object.
 *
 * @param source The cookie string.
 * @returns The parsed cookie, or undefined if the cookie is invalid.
 */
export function parseCookie(source: string): Cookie | undefined {
  const parsed = cookieUtility.parse(source);
  if (!parsed) {
    return undefined;
  }

  const cookie: Cookie = {
    name: parsed.key,
    value: parsed.value,
  };

  const js = parsed.toJSON();
  if ("secure" in js) {
    cookie.secure = js.secure === true;
  }
  if ("httpOnly" in js) {
    cookie.httpOnly = js.httpOnly === true;
  }

  if (parsed.domain !== null) {
    cookie.domain = parsed.domain;
  }
  if (parsed.path !== null) {
    cookie.path = parsed.path;
  }
  if (parsed.expires && parsed.expires !== "Infinity") {
    cookie.expires = new Date(parsed.expires);
  }

  if (parsed.sameSite === "lax") {
    cookie.sameSite = "lax";
  } else if (parsed.sameSite === "strict") {
    cookie.sameSite = "strict";
  } else if (parsed.sameSite === "none") {
    cookie.sameSite = "none";
  }

  if (typeof parsed.maxAge === "number") {
    cookie.maxAge = parsed.maxAge;
  } else if (parsed.maxAge === "-Infinity") {
    cookie.maxAge = -1;
  }

  if (parsed.extensions) {
    for (const extension of parsed.extensions) {
      const parts = extension.toLowerCase().split("=");
      if (parts.length === 2) {
        if (parts[0] === "priority") {
          if (
            parts[1] === "low" ||
            parts[1] === "medium" ||
            parts[1] === "high"
          ) {
            cookie.priority = parts[1];
          } else {
            return undefined;
          }
        } else if (parts[0] === "partitioned") {
          if (parts[1] === "true") {
            cookie.partitioned = true;
          } else if (parts[1] === "false") {
            cookie.partitioned = false;
          } else {
            return undefined;
          }
        } else {
          if (cookie.extra === undefined) {
            cookie.extra = {};
          }
          cookie.extra[parts[0]] = parts[1];
        }
      } else if (parts.length === 1) {
        if (parts[0] === "partitioned") {
          cookie.partitioned = true;
        } else {
          if (cookie.extra === undefined) {
            cookie.extra = {};
          }
          cookie.extra[parts[0]] = "true";
        }
      } else {
        return undefined;
      }
    }
  }

  return cookie;
}

/**
 * Serializes a Cookie object into a Set-Cookie header value.
 */
export function serializeCookie(cookie: Cookie): string {
  const extensions: string[] = [];
  if (cookie.priority !== undefined) {
    extensions.push(`Priority=${cookie.priority};`);
  }
  if (cookie.partitioned !== undefined) {
    extensions.push("Partitioned;");
  }
  // @ts-ignore ...
  return new cookieUtility.Cookie({
    key: cookie.name,
    value: cookie.value,
    domain: cookie.domain ?? null,
    expires: cookie.expires ?? null,
    httpOnly: cookie.httpOnly,
    maxAge: cookie.maxAge ?? null,
    path: cookie.path ?? null,
    sameSite: typeof cookie.sameSite === "boolean"
      ? cookie.sameSite ? "true" : undefined
      : cookie.sameSite,
    secure: cookie.secure,
    extensions,
  }).toString();
}

/**
 * Options for cookie encryptions.
 */
interface CookieEncryptionOptions extends CookieEncryptionAlgorithmOptions {
  /** The password to use for encryption. */
  password: string;
}

interface CookieEncryptionAlgorithmOptions {
  /**
   * The algorithm to use for encryption.
   * Default is "AES-CBC".
   */
  algorithm?: string;

  /**
   * The integrity algorithm to use for HMAC signature.
   * Default is "SHA256".
   */
  integrityAlgorithm?: string;

  /**
   * The number of bits to use for the IV.
   * Default is 128.
   */
  ivBits?: number;

  /**
   * The number of bits to use for the key.
   * Default is 256.
   */
  keyBits?: number;

  /**
   * The number of bits to use for the salt.
   * Default is 256.
   */
  saltsBits?: number;
}

const defaultEncryptionOptions: Required<CookieEncryptionAlgorithmOptions> = {
  algorithm: "AES-CBC",
  integrityAlgorithm: "SHA-256",
  ivBits: 128,
  keyBits: 256,
  saltsBits: 256,
};

/**
 * Parses an encrypted cookie from a Set-Cookie header value.
 *
 * @param cookie The cookie to serialize.
 * @param options The options to use for encryption.
 * @returns The serialized cookie.
 */
export async function parseEncryptedCookie(
  source: string,
  options: CookieEncryptionOptions,
): Promise<Cookie | undefined> {
  const cookie = parseCookie(source);
  if (cookie === undefined) {
    return undefined;
  }

  const cookieValue = await decryptCookieValue(cookie.value, options);
  if (cookieValue === undefined) {
    return undefined;
  }

  cookie.value = cookieValue;

  return cookie;
}

/**
 * Serializes a Cookie object into a Set-Cookie header value that is encrypted with a password.
 */
export async function serializeEncryptedCookie(
  cookie: Cookie,
  options: CookieEncryptionOptions,
): Promise<string> {
  const cookieValue = await encryptCookieValue(cookie.value, options);
  return serializeCookie({ ...cookie, value: cookieValue });
}

/**
 * Parses a cookie header value into a list of cookies.
 *
 * @param header The cookie header value to parse.
 * @returns The parsed cookies.
 */
export function parseCookieHeader(header: string): Cookie[] {
  const cookies: Cookie[] = [];
  for (const cookie of header.split(";")) {
    const parsed = parseCookie(cookie);
    if (parsed !== undefined) {
      cookies.push(parsed);
    }
  }
  return cookies;
}

/**
 * Serializes a list of cookies into a cookie header value.
 *
 * @param cookies The cookies to serialize.
 * @returns The serialized cookie header value.
 */
export function serializeCookieHeader(cookies: Cookie[]): string {
  return cookies
    .map((cookie) =>
      new cookieUtility.Cookie({
        key: cookie.name,
        value: cookie.value,
      }).cookieString()
    )
    .join("; ");
}

const VERSION: string = "1";
const SEPARATOR: string = "|";

/**
 * Encrypts a cookie value.
 */
export async function encryptCookieValue(
  value: string,
  options: CookieEncryptionOptions,
): Promise<string> {
  if (options.password.length < 32) {
    throw new Error("Password must be at least 32 characters long");
  }

  const keyOptions: GenerateKeyOptions = {
    password: options.password,
    algorithm: options.algorithm ?? defaultEncryptionOptions.algorithm,
    integrityAlgorithm: options.integrityAlgorithm ??
      defaultEncryptionOptions.integrityAlgorithm,
    ivBits: options.ivBits ?? defaultEncryptionOptions.ivBits,
    keyBits: options.keyBits ?? defaultEncryptionOptions.keyBits,
    saltsBits: options.saltsBits ?? defaultEncryptionOptions.saltsBits,
  };

  const encryptionKey = await generateKey(keyOptions);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: keyOptions.algorithm,
        iv: encryptionKey.iv,
      } as AesCbcParams,
      encryptionKey.key,
      new TextEncoder().encode(value),
    ),
  );

  const encoded = [
    VERSION,
    Buffer.from(encryptionKey.iv).toString("base64"),
    Buffer.from(encryptionKey.salt).toString("base64"),
    Buffer.from(encrypted).toString("base64"),
    // encodeBase64Url(encryptionKey.iv),
    // encodeBase64Url(encryptionKey.salt),
    // encodeBase64Url(encrypted),
  ].join(SEPARATOR);

  const signed = await sign(encoded, keyOptions);

  return [encoded, signed.digest, signed.salt].join(SEPARATOR);
}

/**
 * Decrypts a cookie value.
 */
export async function decryptCookieValue(
  value: string,
  options: CookieEncryptionOptions,
): Promise<string | undefined> {
  const parts = value.split(SEPARATOR);
  if (parts.length !== 6) {
    return undefined;
  }

  const [version, iv, salt, encrypted, signDigest, signSalt] = parts;
  if (
    version !== VERSION ||
    !iv ||
    !salt ||
    !encrypted ||
    !signDigest ||
    !signSalt
  ) {
    return undefined;
  }

  const keyOptions: GenerateKeyOptions = {
    password: options.password,
    algorithm: options.algorithm ?? defaultEncryptionOptions.algorithm,
    integrityAlgorithm: options.integrityAlgorithm ??
      defaultEncryptionOptions.integrityAlgorithm,
    ivBits: options.ivBits ?? defaultEncryptionOptions.ivBits,
    keyBits: options.keyBits ?? defaultEncryptionOptions.keyBits,
    saltsBits: options.saltsBits ?? defaultEncryptionOptions.saltsBits,
  };

  const signature = await sign([VERSION, iv, salt, encrypted].join(SEPARATOR), {
    ...keyOptions,
    salt: signSalt,
  });
  const textEncoder = new TextEncoder();
  if (
    !timingSafeEqual(
      textEncoder.encode(signature.digest),
      textEncoder.encode(signDigest),
    )
  ) {
    return undefined;
  }

  const textDecoder = new TextDecoder();
  const { key } = await generateKey({
    ...keyOptions,
    // salt: textDecoder.decode(decodeBase64Url(salt)),
    salt: textDecoder.decode(Buffer.from(salt, "base64")),
  });
  const decrypted = await crypto.subtle.decrypt(
    {
      name: keyOptions.algorithm,
      // iv: decodeBase64Url(iv),
      iv: Buffer.from(iv, "base64"),
    } as AesCbcParams,
    key,
    // decodeBase64Url(encrypted),
    Buffer.from(encrypted, "base64"),
  );

  return textDecoder.decode(decrypted);
}

interface EncryptionKey {
  key: CryptoKey;
  iv: Uint8Array;
  salt: string;
}

type GenerateKeyOptions = {
  password: string;
  salt?: string;
  hmac?: boolean;
} & Required<CookieEncryptionAlgorithmOptions>;

async function generateKey(
  options: GenerateKeyOptions,
): Promise<EncryptionKey> {
  const iv = crypto.getRandomValues(
    new Uint8Array(Math.ceil(options.ivBits / 8)),
  );

  const passwordBytes = new TextEncoder().encode(options.password);
  const importedKey = await crypto.subtle.importKey(
    "raw",
    passwordBytes,
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );

  let randomSalt = options.salt;
  if (!randomSalt) {
    const bytes = new Uint8Array(Math.ceil(options.saltsBits / 8));
    crypto.getRandomValues(bytes);
    randomSalt = [...bytes]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  const saltBytes = new TextEncoder().encode(randomSalt);

  const derivedKey = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-1",
      salt: saltBytes,
      iterations: 1,
    },
    importedKey,
    options.keyBits,
  );

  const key = await crypto.subtle.importKey(
    "raw",
    derivedKey,
    options.hmac
      ? { name: "HMAC", hash: options.integrityAlgorithm }
      : { name: options.algorithm },
    false,
    options.hmac ? ["sign", "verify"] : ["encrypt", "decrypt"],
  );

  return { key, iv, salt: randomSalt };
}

async function sign(
  data: string,
  options: GenerateKeyOptions,
): Promise<{ digest: string; salt: string }> {
  const { key, salt } = await generateKey({
    ...options,
    hmac: true,
  });

  const signed = await crypto.subtle.sign(
    { name: "HMAC" },
    key,
    new TextEncoder().encode(data),
  );
  const digest = Buffer.from(new Uint8Array(signed)).toString("base64url");

  return { digest, salt };
}
