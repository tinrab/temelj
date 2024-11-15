import { assertEquals } from "@std/assert";
import { fromRgb, parseRgb } from "./rgb.ts";

Deno.test("Color - rgb - convert", () => {
  assertEquals(parseRgb("rgb(255, 0, 255)"), fromRgb(255, 0, 255));
  assertEquals(parseRgb("rgb(  255,  0  , 255   )"), fromRgb(255, 0, 255));
  assertEquals(parseRgb("rgba(255, 0, 255,1)"), fromRgb(255, 0, 255, 1));
  assertEquals(
    parseRgb("rgba(255, 0, 255,  0.1)"),
    fromRgb(255, 0, 255, 0.1),
  );

  assertEquals(parseRgb(""), undefined);
  assertEquals(parseRgb("rgb(255, 0, 255, 1)"), undefined);
  assertEquals(parseRgb("rgb(10, 10, 300)"), undefined);
});
