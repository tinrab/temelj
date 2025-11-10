import { expect, test } from "vitest";
import { z } from "zod";

import { Registry } from "../registry";
import { createHelperZod } from "../zod_helper_builder";
import { getArrayHelpers } from "./array";
import { getValueHelpers } from "./value";

test("Handlebars value isEmpty helper", () => {
  const r = new Registry();
  r.registerHelpers({ ...getValueHelpers(), ...getArrayHelpers(r) });

  expect(r.render("{{isEmpty 0}}"), "true");
  expect(r.render("{{isEmpty undefined}}"), "true");
  expect(r.render("{{isEmpty false}}"), "true");
  expect(r.render("{{isEmpty ''}}"), "true");
  expect(r.render('{{isEmpty ""}}'), "true");

  expect(r.render('{{isEmpty "a"}}'), "false");
  expect(r.render('{{isEmpty " "}}'), "false");
  expect(r.render("{{isEmpty 42}}"), "false");
  expect(r.render("{{isEmpty (array 4 2)}}"), "false");

  r.registerHelper(
    "displayName",
    createHelperZod()
      .params(
        z.object({
          firstName: z.string(),
          lastName: z.string(),
          age: z.optional(z.number()),
        }),
      )
      .handle(([user]) => {
        // @ts-expect-error user is typed
        const _user: number = user;

        return `${user.firstName} ${user.lastName}`;
      }),
  );
  r.registerHelper(
    "displayName",
    createHelperZod()
      .params(
        z.object({
          name: z.string(),
        }),
        z.boolean().optional(),
      )
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
  expect(r.render("{{jsValue myString}}", { myString: "hello" }), `"hello"`);
  expect(r.render("{{jsValue myString}}", { myString: "he'llo" }), `"he'llo"`);
  expect(
    r.render("{{jsValue myString}}", { myString: 'he"llo' }),
    `"he\\"llo"`,
  );
  expect(
    r.render("{{jsValue myString}}", { myString: "he\\llo" }),
    `"he\\\\llo"`,
  );
  expect(r.render("{{jsValue myNumber}}", { myNumber: 42 }), "42");
  expect(r.render("{{jsValue myFloat}}", { myFloat: 3.14 }), "3.14");
  expect(r.render("{{jsValue myBigInt}}", { myBigInt: 123n }), "123n");
  expect(
    r.render("{{jsValue myBooleanTrue}}", { myBooleanTrue: true }),
    "true",
  );
  expect(
    r.render("{{jsValue myBooleanFalse}}", { myBooleanFalse: false }),
    "false",
  );
  expect(r.render("{{jsValue myNull}}", { myNull: null }), "null");
  expect(
    r.render("{{jsValue myUndefined}}", { myUndefined: undefined }),
    "undefined",
  );
  expect(r.render("{{jsValue myNaN}}", { myNaN: NaN }), "NaN");
  expect(
    r.render("{{jsValue myInfinity}}", { myInfinity: Infinity }),
    "Infinity",
  );
  expect(
    r.render("{{jsValue myNegInfinity}}", { myNegInfinity: -Infinity }),
    "-Infinity",
  );

  // Symbol
  expect(
    r.render("{{jsValue mySymbol}}", { mySymbol: Symbol("desc") }),
    `Symbol("desc")`,
  );
  expect(
    r.render("{{jsValue mySymbolUndef}}", { mySymbolUndef: Symbol(undefined) }),
    `Symbol()`,
  );
  expect(
    r.render("{{jsValue mySymbolEmpty}}", { mySymbolEmpty: Symbol() }),
    `Symbol()`,
  );

  // Arrays
  expect(
    r.render("{{jsValue myArray}}", { myArray: [1, "two", true, null] }),
    `[1, "two", true, null]`,
  );
  expect(r.render("{{jsValue myArray}}", { myArray: [] }), `[]`);
  expect(
    r.render("{{jsValue myArray}}", { myArray: [1, [2, 3], { a: 4n }] }),
    `[1, [2, 3], {"a": 4n}]`,
  );

  // Objects (plain)
  expect(
    r.render("{{jsValue myObject}}", { myObject: { a: 1, b: "two" } }),
    `{"a": 1, "b": "two"}`,
  );
  expect(
    r.render("{{jsValue myObject}}", {
      myObject: { "key with space": 1, sub: { c: null, d: undefined } },
    }),
    `{"key with space": 1, "sub": {"c": null, "d": undefined}}`,
  );
  expect(r.render("{{jsValue myObject}}", { myObject: {} }), `{}`);
  const objWithProtoNull = Object.create(null);
  objWithProtoNull.a = 1;
  expect(r.render("{{jsValue val}}", { val: objWithProtoNull }), `{"a": 1}`);

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
  expect(
    r.render("{{jsValue val}}", { val: myMap }),
    `new Map([["key1", "value1"], [2, true], [{"a": 1}, 3n], [Symbol("mapkey"), "mapvalue"]])`,
  );
  expect(r.render("{{jsValue val}}", { val: new Map() }), `new Map([])`);

  // Set
  const mySet = new Set<unknown>([
    "value1",
    2,
    true,
    { b: "set value" },
    Symbol("setval"),
  ]);
  expect(
    r.render("{{jsValue val}}", { val: mySet }),
    `new Set(["value1", 2, true, {"b": "set value"}, Symbol("setval")])`,
  );
  expect(r.render("{{jsValue val}}", { val: new Set() }), `new Set([])`);

  // Date
  const myDate = new Date(Date.UTC(2024, 0, 20, 10, 30, 0, 123)); // 20 Jan 2024, 10:30:00.123 UTC
  const expectedDateStr = `new Date("${myDate.toISOString()}")`;
  expect(r.render("{{jsValue val}}", { val: myDate }), expectedDateStr);

  // RegExp
  expect(r.render("{{jsValue val}}", { val: /abc/gi }), "/abc/gi");
  expect(r.render("{{jsValue val}}", { val: /xyz/m }), "/xyz/m");

  // Nested structures
  const nested = {
    arr: [new Map([[1, new Set([2, "s"])]])],
    obj: { date: new Date(0), rgx: /test/ },
  };
  const expectedNested = `{"arr": [new Map([[1, new Set([2, "s"])]])], "obj": {"date": new Date("1970-01-01T00:00:00.000Z"), "rgx": /test/}}`;
  expect(r.render("{{jsValue val}}", { val: nested }), expectedNested);

  // Class instance with toJSON
  class MyClass {
    constructor(
      public x: number,
      public y: string,
    ) {}
    toJSON(): unknown {
      return { xVal: this.x, yVal: this.y, type: "MyClassInstance" };
    }
  }
  const myInstance = new MyClass(10, "hello");
  expect(
    r.render("{{jsValue val}}", { val: myInstance }),
    `{"xVal": 10, "yVal": "hello", "type": "MyClassInstance"}`,
  );

  // Object that stringifies to a primitive via toJSON
  class StringifiesToPrimitive {
    toJSON(): unknown {
      return "primitive_value";
    }
  }
  expect(
    r.render("{{jsValue val}}", { val: new StringifiesToPrimitive() }),
    `"primitive_value"`,
  );

  class StringifiesToNumber {
    toJSON(): unknown {
      return 12345;
    }
  }
  expect(
    r.render("{{jsValue val}}", { val: new StringifiesToNumber() }),
    `12345`,
  );
});
