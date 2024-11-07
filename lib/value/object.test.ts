import { assertEquals } from "@std/assert";
import { objectDeepMerge } from "./object.ts";

Deno.test("objectDeepMerge() works", () => {
  const obj1 = { x: 1, y: 2, a: [1, 2] };
  const obj2 = { z: 3, w: 4, a: [3, 4] };
  const obj3 = { s: "foo" };
  assertEquals(objectDeepMerge(obj1, obj2, obj3), {
    x: 1,
    y: 2,
    z: 3,
    w: 4,
    a: [1, 2, 3, 4],
    s: "foo",
  });
});
