import { expect, test } from "vitest";

import {
  generateUuid4,
  getUuid4Bytes,
  isUuid4Valid,
  makeUuid4FromBytes,
} from "./uuid4";

test("generateUuid4() works", () => {
  const id = generateUuid4();
  expect(id.length).toStrictEqual(36);
  expect(id.split("-").length).toStrictEqual(5);
  expect(id).toMatch(/^[0-9A-Fa-f]{4}(?:-?[0-9A-Fa-f]{4}){7}$/);
});

test("isUuid4Valid() works", () => {
  const id = "abcdef01-2345-6789-abcd-ef0123456789";
  expect(isUuid4Valid(id)).toStrictEqual(true);

  expect(isUuid4Valid("")).toStrictEqual(false);
  expect(isUuid4Valid("1234567890")).toStrictEqual(false);
  expect(isUuid4Valid("12345678-1234-1234-1234-1234567890")).toStrictEqual(
    false,
  );
});

test("Uuid4 bytes", () => {
  const id = "abcdef01-2345-6789-abcd-ef0123456789";
  const bytes = getUuid4Bytes(id);
  expect(bytes.length).toStrictEqual(16);
  expect(makeUuid4FromBytes(bytes)).toStrictEqual(id);
});
