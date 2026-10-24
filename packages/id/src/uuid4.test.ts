import { expect, test } from "vitest";

import { IdFormatError } from "./errors";
import {
  generateUuid4,
  getUuid4Bytes,
  isUuid4Valid,
  makeUuid4FromBytes,
  UUID4_MAX,
  UUID4_MIN,
} from "./uuid4";

test("generateUuid4() works", () => {
  const id = generateUuid4();
  expect(id.length).toStrictEqual(36);
  expect(id.split("-").length).toStrictEqual(5);
  expect(id).toMatch(/^[0-9A-Fa-f]{4}(?:-?[0-9A-Fa-f]{4}){7}$/);
});

test("isUuid4Valid() works", () => {
  const id = "abcdef01-2345-4789-abcd-ef0123456789";
  expect(isUuid4Valid(id)).toStrictEqual(true);

  expect(isUuid4Valid("")).toStrictEqual(false);
  expect(isUuid4Valid("1234567890")).toStrictEqual(false);
  expect(isUuid4Valid("12345678-1234-1234-1234-1234567890")).toStrictEqual(false);
});

test.each([
  "abcdef01-2345-6789-abcd-ef0123456789",
  "abcdef01-2345-4789-0bcd-ef0123456789",
  "abcdef01-2345-4789-cbcd-ef0123456789",
])("rejects a UUID without v4 version and variant bits: %s", (id) => {
  expect(isUuid4Valid(id)).toBe(false);
});

test("Uuid4 bytes", () => {
  const id = "abcdef01-2345-4789-abcd-ef0123456789";
  const bytes = getUuid4Bytes(id);
  expect(bytes.length).toStrictEqual(16);
  expect(makeUuid4FromBytes(bytes)).toStrictEqual(id);
});

test("rejects invalid UUID v4 input", () => {
  expect(() => getUuid4Bytes("abcdef01-2345-6789-abcd-ef0123456789")).toThrow(IdFormatError);
  expect(() => makeUuid4FromBytes(new Uint8Array(15))).toThrow(IdFormatError);
  expect(() => makeUuid4FromBytes(new Uint8Array(16))).toThrow(IdFormatError);
});

test("generated UUIDs set v4 version and variant bits", () => {
  for (let i = 0; i < 100; i++) {
    expect(isUuid4Valid(generateUuid4())).toBe(true);
  }
});

test("UUID v4 bounds round-trip", () => {
  expect(makeUuid4FromBytes(getUuid4Bytes(UUID4_MIN))).toBe(UUID4_MIN);
  expect(makeUuid4FromBytes(getUuid4Bytes(UUID4_MAX))).toBe(UUID4_MAX);
});
