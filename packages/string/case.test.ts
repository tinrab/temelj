import { expect, test } from "vitest";

import { toCamelCase, toKebabCase, toPascalCase, toSnakeCase } from "./case";

test("convert case", () => {
  expect(toCamelCase("Hello World"), "helloWorld");
  expect(toCamelCase("user_name"), "userName");

  expect(toSnakeCase("A b"), "a_b");
  expect(toSnakeCase("Ab42"), "ab42");

  expect(toPascalCase("Hello World"), "HelloWorld");
  expect(toPascalCase("data-type-id"), "DataTypeId");
  expect(toPascalCase("get_User"), "GetUser");

  expect(toKebabCase("Hello World"), "hello-world");
  expect(toKebabCase("user_name"), "user-name");
});
