import { assert, assertEquals, assertMatch } from "@std/assert";

import {
  generateUuid4,
  getUuid4Bytes,
  isUuid4Valid,
  makeUuid4FromBytes,
} from "./uuid4.ts";

Deno.test("generateUuid4() works", () => {
  const id = generateUuid4();
  assertEquals(id.length, 36);
  assertEquals(id.split("-").length, 5);
  assertMatch(
    id,
    /^[0-9A-Fa-f]{4}(?:-?[0-9A-Fa-f]{4}){7}$/,
  );
});

Deno.test("isUuid4Valid() works", () => {
  const id = "abcdef01-2345-6789-abcd-ef0123456789";
  assert(isUuid4Valid(id));

  assert(!isUuid4Valid(""));
  assert(!isUuid4Valid("1234567890"));
  assert(!isUuid4Valid("12345678-1234-1234-1234-1234567890"));
});

Deno.test("Uuid4 bytes", () => {
  const id = "abcdef01-2345-6789-abcd-ef0123456789";
  const bytes = getUuid4Bytes(id);
  assertEquals(bytes.length, 16);
  assertEquals(makeUuid4FromBytes(bytes), id);
});
