import { expect, test } from "vitest";

import { parseHex, toHex } from "./hex";
import { fromRgb } from "./rgb";

test("Color - hex - convert", () => {
  expect(parseHex("#FF00FF")).toStrictEqual(fromRgb(255, 0, 255));
  expect(parseHex("#FF00FFFF")).toStrictEqual(fromRgb(255, 0, 255, 1.0));

  expect(parseHex("")).toBeUndefined();
  expect(parseHex("#FF")).toBeUndefined();
  expect(parseHex("FFFFFFF")).toBeUndefined();
  expect(parseHex("#")).toBeUndefined();
  expect(parseHex("#FF00FZ")).toBeUndefined();

  expect(toHex(fromRgb(255, 0, 255))).toStrictEqual("ff00ff");
});
