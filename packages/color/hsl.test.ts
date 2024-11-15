import { assertEquals } from "@std/assert";
import { fromHsl, hslToRgb } from "./hsl.ts";
import { fromRgb } from "./rgb.ts";

Deno.test("Color - hsl - convert", () => {
  assertEquals(hslToRgb(fromHsl(420, 0.31, 0.4)), fromRgb(134, 134, 70));
  assertEquals(
    hslToRgb(fromHsl(420, 0.31, 0.4, 0.7)),
    fromRgb(134, 134, 70, 0.7),
  );
});
