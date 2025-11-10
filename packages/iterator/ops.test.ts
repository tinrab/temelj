import { expect, test } from "vitest";

import { collectMap } from "./ops";

test("collectMap() works", () => {
  expect(
    collectMap([1, 2, 3], (item) => item * 2),
    { 2: 1, 4: 2, 6: 3 },
  );
});
