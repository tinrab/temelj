import { expect, test } from "vitest";

import {
  generateUuid4,
  getUuid4Bytes,
  isUuid4Valid,
  makeUuid4FromBytes,
} from "./uuid4";

test("generateUuid4() works", () => {
  const id = generateUuid4();
  expect(id.length).toBe(36);
  expect(id.split("-").length).toBe(5);
  expect(id).toMatch(/^[0-9A-Fa-f]{4}(?:-?[0-9A-Fa-f]{4}){7}$/);
});

test("isUuid4Valid() works", () => {
  const id = "abcdef01-2345-6789-abcd-ef0123456789";
  expect(isUuid4Valid(id)).toBe(true);

  expect(isUuid4Valid("")).toBe(false);
  expect(isUuid4Valid("1234567890")).toBe(false);
  expect(isUuid4Valid("12345678-1234-1234-1234-1234567890")).toBe(false);
});

test("Uuid4 bytes", () => {
  const id = "abcdef01-2345-6789-abcd-ef0123456789";
  const bytes = getUuid4Bytes(id);
  expect(bytes.length).toBe(16);
  expect(makeUuid4FromBytes(bytes)).toBe(id);
});
