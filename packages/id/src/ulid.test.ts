import { expect, test, vi } from "vitest";

import { IdFormatError, IdOptionsError } from "./errors";
import {
  generateUlid,
  generateUlidList,
  getUlidBytes,
  isUlidValid,
  makeUlidFromBytes,
} from "./ulid";

test("generateUlid() works", () => {
  let id = generateUlid();
  expect(id.length).toStrictEqual(26);
  expect(id).toMatch(/^[0-9A-Z]{26}$/);

  const ids = new Set<string>();

  for (let i = 0; i < 5; i++) {
    ids.add(generateUlid());
  }

  expect(ids.size).toStrictEqual(5);

  id = generateUlid({
    time: new Date(42),
    random: Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09]),
  });
  expect(id).toStrictEqual("000000001A000G40R40M30E209");
});

test.each([0, 42, 0x01_02_03_04_05_06, 2 ** 48 - 1])(
  "preserves the full 48-bit timestamp %i with explicit random bytes",
  (time) => {
    const random = new Uint8Array(10).fill(0x42);
    const bytes = getUlidBytes(generateUlid({ time: new Date(time), random }));
    const timestamp = [...bytes.subarray(0, 6)].reduce((value, byte) => value * 256 + byte, 0);
    expect(timestamp).toBe(time);
    expect(bytes.subarray(6)).toEqual(random);
  },
);

test.each([new Date(-1), new Date(2 ** 48), new Date(Number.NaN)])(
  "rejects an invalid deterministic timestamp %s",
  (time) => {
    expect(() => generateUlid({ time, random: new Uint8Array(10) })).toThrow("48-bit");
    expect(() => generateUlid({ time })).toThrow("48-bit");
    expect(() => generateUlidList(1, { time })).toThrow("48-bit");
  },
);

test("isUlidValid() works", () => {
  const id = generateUlid();
  expect(isUlidValid(id)).toStrictEqual(true);

  expect(isUlidValid("")).toStrictEqual(false);
  expect(isUlidValid("1234567890")).toStrictEqual(false);
});

test("generateUlidList() works", () => {
  const ids = generateUlidList(5);
  expect(ids.length).toStrictEqual(5);
  expect(ids.every((id) => id.length === 26)).toStrictEqual(true);
  expect(ids.every((id) => id.match(/^[0-9A-Z]{26}$/))).toStrictEqual(true);
});

test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
  "rejects invalid ULID count %s",
  (count) => {
    expect(() => generateUlidList(count)).toThrow("count");
  },
);

test("generating zero ULIDs returns an empty list", () => {
  expect(generateUlidList(0)).toEqual([]);
});

test("Ulid bytes", () => {
  const id = "01BXZ26W400000000000000000";
  const bytes = getUlidBytes(id);
  expect(bytes.length).toStrictEqual(16);
  expect(makeUlidFromBytes(bytes)).toStrictEqual(id);
});

test("ULID decoding is case-insensitive and accepts Crockford aliases", () => {
  expect(getUlidBytes("01bxz26w400000000000000000")).toEqual(
    getUlidBytes("01BXZ26W400000000000000000"),
  );
  expect(getUlidBytes("0ILO0000000000000000000000")).toEqual(
    getUlidBytes("01100000000000000000000000"),
  );
});

test.each([
  "",
  "8ZZZZZZZZZZZZZZZZZZZZZZZZZ",
  "01BXZ26W40000000000000000U",
  "01BXZ26W40000000000000000-",
])("rejects invalid ULID %s", (id) => {
  expect(isUlidValid(id)).toBe(false);
  expect(() => getUlidBytes(id)).toThrow(IdFormatError);
});

test("encodes the maximum ULID", () => {
  expect(makeUlidFromBytes(new Uint8Array(16).fill(0xff))).toBe("7ZZZZZZZZZZZZZZZZZZZZZZZZZ");
  expect(() => makeUlidFromBytes(new Uint8Array(15))).toThrow(IdFormatError);
});

test("generateUlidList() increments the random component within a millisecond", () => {
  const time = new Date(42);
  mockRandomBytes((bytes) => bytes.fill(0x00).fill(0xff, -1));

  try {
    expect(generateUlidList(3, { time })).toEqual([
      "000000001A000000000000007Z",
      "000000001A0000000000000080",
      "000000001A0000000000000081",
    ]);
  } finally {
    vi.restoreAllMocks();
  }
});

test("generateUlidList() fails when the random component overflows", () => {
  mockRandomBytes((bytes) => bytes.fill(0xff));

  try {
    expect(() => generateUlidList(2, { time: new Date(42) })).toThrow(IdOptionsError);
  } finally {
    vi.restoreAllMocks();
  }
});

function mockRandomBytes(fill: (bytes: Uint8Array) => void): void {
  vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
    if (array instanceof Uint8Array) {
      fill(array);
    }

    return array;
  });
}
