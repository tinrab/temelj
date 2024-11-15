import { assertEquals } from "@std/assert";
import { parseHex, toHex } from "./hex.ts";
import { fromRgb } from "./rgb.ts";

Deno.test("Color - hex - convert", () => {
  assertEquals(parseHex("#FF00FF"), fromRgb(255, 0, 255));
  assertEquals(parseHex("#FF00FFFF"), fromRgb(255, 0, 255, 1.0));

  assertEquals(parseHex(""), undefined);
  assertEquals(parseHex("#FF"), undefined);
  assertEquals(parseHex("FFFFFFF"), undefined);
  assertEquals(parseHex("#"), undefined);
  assertEquals(parseHex("#FF00FZ"), undefined);

  assertEquals(toHex(fromRgb(255, 0, 255)), "ff00ff");
});
