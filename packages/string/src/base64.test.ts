import { describe, expect, test, vi } from "vitest";

import {
  decodeBase64,
  decodeBase64String,
  decodeBase64Url,
  decodeBase64UrlString,
  encodeBase64,
  encodeBase64String,
  encodeBase64Url,
  encodeBase64UrlString,
} from "./base64";

describe("base64", () => {
  test("encode bytes as base64", () => {
    expect(encodeBase64(new Uint8Array([104, 101, 108, 108, 111]))).toBe("aGVsbG8=");
  });

  test("decode base64 to bytes", () => {
    expect(Array.from(decodeBase64("aGVsbG8="))).toEqual([104, 101, 108, 108, 111]);
  });

  test("encode and decode base64 strings", () => {
    expect(encodeBase64String("hello")).toBe("aGVsbG8=");
    expect(decodeBase64String("aGVsbG8=")).toBe("hello");
  });

  test("encode bytes with Uint8Array toBase64 when available", () => {
    const value = new Uint8Array([1, 2, 3]);
    const toBase64 = vi.fn<() => string>(() => "native");
    Object.defineProperty(value, "toBase64", { configurable: true, value: toBase64 });

    expect(encodeBase64(value)).toBe("native");
    expect(toBase64).toHaveBeenCalledWith();
  });

  test("encode bytes as unpadded base64url", () => {
    expect(encodeBase64Url(new Uint8Array([251, 255, 255]))).toBe("-___");
  });

  test("decode base64url to bytes", () => {
    expect(Array.from(decodeBase64Url("-___"))).toEqual([251, 255, 255]);
  });

  test("encode and decode base64url strings", () => {
    expect(encodeBase64UrlString("hello?")).toBe("aGVsbG8_");
    expect(decodeBase64UrlString("aGVsbG8_")).toBe("hello?");
  });

  test("encode base64url with Uint8Array toBase64 when available", () => {
    const value = new Uint8Array([1, 2, 3]);
    const toBase64 = vi.fn<() => string>(() => "native-url");
    Object.defineProperty(value, "toBase64", { configurable: true, value: toBase64 });

    expect(encodeBase64Url(value)).toBe("native-url");
    expect(toBase64).toHaveBeenCalledWith({ alphabet: "base64url", omitPadding: true });
  });
});
