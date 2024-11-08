import { assertEquals } from "@std/assert";
import { getStringHelpers } from "./string.ts";

Deno.test("Handlebars string helpers", () => {
  const helpers = getStringHelpers();

  assertEquals(helpers.camelCase("Hello World"), "helloWorld");
});
