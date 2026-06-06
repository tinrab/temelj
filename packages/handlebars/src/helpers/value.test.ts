import { ss } from "@temelj/standard-schema";
import { expect, test } from "vitest";
import * as z from "zod";

import { createHelper } from "../helper_builder";
import { Registry } from "../registry";
import { getArrayHelpers } from "./array";
import { getValueHelpers } from "./value";

const userSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  age: z.number().optional(),
});

const namedSchema = z.object({
  name: z.string(),
});

test("Handlebars value isEmpty helper", () => {
  const r = new Registry();
  r.registerHelpers({ ...getValueHelpers(), ...getArrayHelpers(r) });

  expect(r.render("{{isEmpty 0}}")).toBe("true");
  expect(r.render("{{isEmpty undefined}}")).toBe("true");
  expect(r.render("{{isEmpty false}}")).toBe("true");
  expect(r.render("{{isEmpty ''}}")).toBe("true");
  expect(r.render('{{isEmpty ""}}')).toBe("true");

  expect(r.render('{{isEmpty "a"}}')).toBe("false");
  expect(r.render('{{isEmpty " "}}')).toBe("false");
  expect(r.render("{{isEmpty 42}}")).toBe("false");
  expect(r.render("{{isEmpty (array 4 2)}}")).toBe("false");

  r.registerHelper(
    "displayName",
    createHelper()
      .params(userSchema)
      .handle(([user]) => {
        // @ts-expect-error user is typed
        const _user: number = user;

        return `${user.firstName} ${user.lastName}`;
      }),
  );
  r.registerHelper(
    "displayName",
    createHelper()
      .params(namedSchema, ss.optional(ss.boolean()))
      .handle((params) => {
        const _name: string = params[0].name;
        const _isShort: boolean = params[1] ?? false;
        return "";
      }),
  );
});

test("Handlebars value jsValue helper", () => {
  const r = new Registry();
  r.registerHelpers(getValueHelpers());

  // Primitives
  expect(r.render("{{jsValue myString}}", { myString: "hello" })).toBe(`"hello"`);
  expect(r.render("{{jsValue myString}}", { myString: "he'llo" })).toBe(`"he'llo"`);
  expect(r.render("{{jsValue myString}}", { myString: 'he"llo' })).toBe(`"he\\"llo"`);
  expect(r.render("{{jsValue myString}}", { myString: "he\\llo" })).toBe(`"he\\\\llo"`);
  expect(r.render("{{jsValue myNumber}}", { myNumber: 42 })).toBe("42");
  expect(r.render("{{jsValue myFloat}}", { myFloat: 3.14 })).toBe("3.14");
  expect(r.render("{{jsValue myBigInt}}", { myBigInt: 123n })).toBe("123n");
  expect(r.render("{{jsValue myBooleanTrue}}", { myBooleanTrue: true })).toBe("true");
  expect(r.render("{{jsValue myBooleanFalse}}", { myBooleanFalse: false })).toBe("false");
  expect(r.render("{{jsValue myNull}}", { myNull: null })).toBe("null");
  expect(r.render("{{jsValue myUndefined}}", { myUndefined: undefined })).toBe("undefined");
  expect(r.render("{{jsValue myNaN}}", { myNaN: NaN })).toBe("NaN");
  expect(r.render("{{jsValue myInfinity}}", { myInfinity: Infinity })).toBe("Infinity");
  expect(r.render("{{jsValue myNegInfinity}}", { myNegInfinity: -Infinity })).toBe("-Infinity");

  // Symbol
  expect(r.render("{{jsValue mySymbol}}", { mySymbol: Symbol("desc") })).toBe(`Symbol("desc")`);
  expect(r.render("{{jsValue mySymbolUndef}}", { mySymbolUndef: Symbol(undefined) })).toBe(
    `Symbol()`,
  );
  expect(r.render("{{jsValue mySymbolEmpty}}", { mySymbolEmpty: Symbol() })).toBe(`Symbol()`);

  // Arrays
  expect(r.render("{{jsValue myArray}}", { myArray: [1, "two", true, null] })).toBe(
    `[1, "two", true, null]`,
  );
  expect(r.render("{{jsValue myArray}}", { myArray: [] })).toBe(`[]`);
  expect(r.render("{{jsValue myArray}}", { myArray: [1, [2, 3], { a: 4n }] })).toBe(
    `[1, [2, 3], {"a": 4n}]`,
  );

  // Objects (plain)
  expect(r.render("{{jsValue myObject}}", { myObject: { a: 1, b: "two" } })).toBe(
    `{"a": 1, "b": "two"}`,
  );
  expect(
    r.render("{{jsValue myObject}}", {
      myObject: { "key with space": 1, sub: { c: null, d: undefined } },
    }),
  ).toBe(`{"key with space": 1, "sub": {"c": null, "d": undefined}}`);
  expect(r.render("{{jsValue myObject}}", { myObject: {} })).toBe(`{}`);
  const objWithProtoNull = Object.create(null);
  objWithProtoNull.a = 1;
  expect(r.render("{{jsValue val}}", { val: objWithProtoNull })).toBe(`{"a": 1}`);

  // Map
  const myMap = new Map<unknown, unknown>([
    ["key1", "value1"],
    [2, true],
    [
      {
        a: 1,
      },
      3n,
    ],
    [Symbol("mapkey"), "mapvalue"],
  ]);
  expect(r.render("{{jsValue val}}", { val: myMap })).toBe(
    `new Map([["key1", "value1"], [2, true], [{"a": 1}, 3n], [Symbol("mapkey"), "mapvalue"]])`,
  );
  expect(r.render("{{jsValue val}}", { val: new Map() })).toBe(`new Map([])`);

  // Set
  const mySet = new Set<unknown>(["value1", 2, true, { b: "set value" }, Symbol("setval")]);
  expect(r.render("{{jsValue val}}", { val: mySet })).toBe(
    `new Set(["value1", 2, true, {"b": "set value"}, Symbol("setval")])`,
  );
  expect(r.render("{{jsValue val}}", { val: new Set() })).toBe(`new Set([])`);

  // Date
  const myDate = new Date(Date.UTC(2024, 0, 20, 10, 30, 0, 123)); // 20 Jan 2024, 10:30:00.123 UTC
  const expectedDateStr = `new Date("${myDate.toISOString()}")`;
  expect(r.render("{{jsValue val}}", { val: myDate })).toBe(expectedDateStr);

  // RegExp
  expect(r.render("{{jsValue val}}", { val: /abc/gi })).toBe("/abc/gi");
  expect(r.render("{{jsValue val}}", { val: /xyz/m })).toBe("/xyz/m");

  // Nested structures
  const nested = {
    arr: [new Map([[1, new Set([2, "s"])]])],
    obj: { date: new Date(0), rgx: /test/ },
  };
  const expectedNested = `{"arr": [new Map([[1, new Set([2, "s"])]])], "obj": {"date": new Date("1970-01-01T00:00:00.000Z"), "rgx": /test/}}`;
  expect(r.render("{{jsValue val}}", { val: nested })).toBe(expectedNested);

  // Class instance with toJSON
  class MyClass {
    public x: number;
    public y: string;

    constructor(x: number, y: string) {
      this.x = x;
      this.y = y;
    }
    toJSON(): unknown {
      return { xVal: this.x, yVal: this.y, type: "MyClassInstance" };
    }
  }
  const myInstance = new MyClass(10, "hello");
  expect(r.render("{{jsValue val}}", { val: myInstance })).toBe(
    `{"xVal": 10, "yVal": "hello", "type": "MyClassInstance"}`,
  );

  // Object that stringifies to a primitive via toJSON
  class StringifiesToPrimitive {
    toJSON(): unknown {
      return "primitive_value";
    }
  }
  expect(r.render("{{jsValue val}}", { val: new StringifiesToPrimitive() })).toBe(
    `"primitive_value"`,
  );

  class StringifiesToNumber {
    toJSON(): unknown {
      return 12345;
    }
  }
  expect(r.render("{{jsValue val}}", { val: new StringifiesToNumber() })).toBe(`12345`);
});
