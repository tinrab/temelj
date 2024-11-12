import { assert, assertEquals, assertMatch } from "@std/assert";

import {
  generateUlid,
  generateUlidList,
  getUlidBytes,
  isUlidValid,
  makeUlidFromBytes,
} from "./ulid.ts";

Deno.test("generateUlid() works", () => {
  let id = generateUlid();
  assertEquals(id.length, 26);
  assertMatch(id, /^[0-9A-Z]{26}$/);

  const ids = new Set<string>();
  for (let i = 0; i < 5; i++) {
    ids.add(generateUlid());
  }
  assertEquals(ids.size, 5);

  id = generateUlid({
    time: new Date(42),
    random: Uint8Array.from([
      0x00,
      0x01,
      0x02,
      0x03,
      0x04,
      0x05,
      0x06,
      0x07,
      0x08,
      0x09,
    ]),
  });
  assertEquals(id, "005800001A000G40R40M30E209");
});

Deno.test("isUlidValid() works", () => {
  const id = generateUlid();
  assert(isUlidValid(id));

  assert(!isUlidValid(""));
  assert(!isUlidValid("1234567890"));
});

Deno.test("generateUlidList() works", () => {
  const ids = generateUlidList(5);
  assertEquals(ids.length, 5);
  assert(ids.every((id) => id.length === 26));
  assert(ids.every((id) => id.match(/^[0-9A-Z]{26}$/)));
});

Deno.test("Ulid bytes", () => {
  const id = "01BXZ26W400000000000000000";
  const bytes = getUlidBytes(id);
  assertEquals(bytes.length, 16);
  assertEquals(makeUlidFromBytes(bytes), id);
});
