import { expect, test } from "vitest";

import { toCamelCase, toKebabCase, toPascalCase, toSnakeCase } from "./case";

test("convert case", () => {
  expect(toCamelCase("Hello World")).toBe("helloWorld");
  expect(toCamelCase("user_name")).toBe("userName");

  expect(toSnakeCase("A b")).toBe("a_b");
  expect(toSnakeCase("Ab42")).toBe("ab42");

  expect(toPascalCase("Hello World")).toBe("HelloWorld");
  expect(toPascalCase("data-type-id")).toBe("DataTypeId");
  expect(toPascalCase("get_User")).toBe("GetUser");

  expect(toKebabCase("Hello World")).toBe("hello-world");
  expect(toKebabCase("user_name")).toBe("user-name");
});
