import { expect, test } from "vitest";

import { fromHsl, hslToRgb } from "./hsl";
import { fromRgb } from "./rgb";

test("Color - hsl - convert", () => {
  expect(hslToRgb(fromHsl(420, 0.31, 0.4)), fromRgb(134, 134, 70));
  expect(hslToRgb(fromHsl(420, 0.31, 0.4, 0.7)), fromRgb(134, 134, 70, 0.7));
});
