import { assertEquals } from "@std/assert";

import { toCamelCase, toKebabCase, toPascalCase, toSnakeCase } from "./case.ts";

Deno.test("convert case", () => {
  assertEquals(toCamelCase("Hello World"), "helloWorld");
  assertEquals(toCamelCase("user_name"), "userName");

  assertEquals(toSnakeCase("A b"), "a_b");
  assertEquals(toSnakeCase("Ab42"), "ab42");

  assertEquals(toPascalCase("Hello World"), "HelloWorld");
  assertEquals(toPascalCase("data-type-id"), "DataTypeId");
  assertEquals(toPascalCase("get_User"), "GetUser");

  assertEquals(toKebabCase("Hello World"), "hello-world");
  assertEquals(toKebabCase("user_name"), "user-name");
});
