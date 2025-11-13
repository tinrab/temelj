import { expect, test } from "vitest";

import { fromRgb, parseRgb } from "./rgb";

test("Color - rgb - convert", () => {
  expect(parseRgb("rgb(255, 0, 255)")).toStrictEqual(fromRgb(255, 0, 255));
  expect(parseRgb("rgb(  255,  0  , 255   )")).toStrictEqual(
    fromRgb(255, 0, 255),
  );
  expect(parseRgb("rgba(255, 0, 255,1)")).toStrictEqual(
    fromRgb(255, 0, 255, 1),
  );
  expect(parseRgb("rgba(255, 0, 255,  0.1)")).toStrictEqual(
    fromRgb(255, 0, 255, 0.1),
  );

  expect(parseRgb("")).toBeUndefined();
  expect(parseRgb("rgb(255, 0, 255, 1)")).toBeUndefined();
  expect(parseRgb("rgb(10, 10, 300)")).toBeUndefined();
});
