import { assertEquals } from "@std/assert";
import { z } from "zod";

import { Registry } from "../registry.ts";
import { createHelperZod } from "../zod_helper_builder.ts";
import { getArrayHelpers } from "./array.ts";
import { getValueHelpers } from "./value.ts";

Deno.test("Handlebars value isEmpty helper", () => {
  const r = new Registry();
  r.registerHelpers({ ...getValueHelpers(), ...getArrayHelpers(r) });

  assertEquals(r.render("{{isEmpty 0}}"), "true");
  assertEquals(r.render("{{isEmpty undefined}}"), "true");
  assertEquals(r.render("{{isEmpty false}}"), "true");
  assertEquals(r.render("{{isEmpty ''}}"), "true");
  assertEquals(r.render('{{isEmpty ""}}'), "true");

  assertEquals(r.render('{{isEmpty "a"}}'), "false");
  assertEquals(r.render('{{isEmpty " "}}'), "false");
  assertEquals(r.render("{{isEmpty 42}}"), "false");
  assertEquals(r.render("{{isEmpty (array 4 2)}}"), "false");

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

Deno.test("Handlebars value jsValue helper", () => {
  const r = new Registry();
  r.registerHelpers(getValueHelpers());

  // Primitives
  assertEquals(
    r.render("{{jsValue myString}}", { myString: "hello" }),
    `"hello"`,
  );
  assertEquals(
    r.render("{{jsValue myString}}", { myString: "he'llo" }),
    `"he'llo"`,
  );
  assertEquals(
    r.render("{{jsValue myString}}", { myString: 'he"llo' }),
    `"he\\"llo"`,
  );
  assertEquals(
    r.render("{{jsValue myString}}", { myString: "he\\llo" }),
    `"he\\\\llo"`,
  );
  assertEquals(r.render("{{jsValue myNumber}}", { myNumber: 42 }), "42");
  assertEquals(r.render("{{jsValue myFloat}}", { myFloat: 3.14 }), "3.14");
  assertEquals(r.render("{{jsValue myBigInt}}", { myBigInt: 123n }), "123n");
  assertEquals(
    r.render("{{jsValue myBooleanTrue}}", { myBooleanTrue: true }),
    "true",
  );
  assertEquals(
    r.render("{{jsValue myBooleanFalse}}", { myBooleanFalse: false }),
    "false",
  );
  assertEquals(r.render("{{jsValue myNull}}", { myNull: null }), "null");
  assertEquals(
    r.render("{{jsValue myUndefined}}", { myUndefined: undefined }),
    "undefined",
  );
  assertEquals(r.render("{{jsValue myNaN}}", { myNaN: NaN }), "NaN");
  assertEquals(
    r.render("{{jsValue myInfinity}}", { myInfinity: Infinity }),
    "Infinity",
  );
  assertEquals(
    r.render("{{jsValue myNegInfinity}}", { myNegInfinity: -Infinity }),
    "-Infinity",
  );

  // Symbol
  assertEquals(
    r.render("{{jsValue mySymbol}}", { mySymbol: Symbol("desc") }),
    `Symbol("desc")`,
  );
  assertEquals(
    r.render("{{jsValue mySymbolUndef}}", { mySymbolUndef: Symbol(undefined) }),
    `Symbol()`,
  );
  assertEquals(
    r.render("{{jsValue mySymbolEmpty}}", { mySymbolEmpty: Symbol() }),
    `Symbol()`,
  );

  // Arrays
  assertEquals(
    r.render("{{jsValue myArray}}", { myArray: [1, "two", true, null] }),
    `[1, "two", true, null]`,
  );
  assertEquals(r.render("{{jsValue myArray}}", { myArray: [] }), `[]`);
  assertEquals(
    r.render("{{jsValue myArray}}", { myArray: [1, [2, 3], { a: 4n }] }),
    `[1, [2, 3], {"a": 4n}]`,
  );

  // Objects (plain)
  assertEquals(
    r.render("{{jsValue myObject}}", { myObject: { a: 1, b: "two" } }),
    `{"a": 1, "b": "two"}`,
  );
  assertEquals(
    r.render("{{jsValue myObject}}", {
      myObject: { "key with space": 1, sub: { c: null, d: undefined } },
    }),
    `{"key with space": 1, "sub": {"c": null, "d": undefined}}`,
  );
  assertEquals(r.render("{{jsValue myObject}}", { myObject: {} }), `{}`);
  const objWithProtoNull = Object.create(null);
  objWithProtoNull.a = 1;
  assertEquals(
    r.render("{{jsValue val}}", { val: objWithProtoNull }),
    `{"a": 1}`,
  );

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
  assertEquals(
    r.render("{{jsValue val}}", { val: myMap }),
    `new Map([["key1", "value1"], [2, true], [{"a": 1}, 3n], [Symbol("mapkey"), "mapvalue"]])`,
  );
  assertEquals(r.render("{{jsValue val}}", { val: new Map() }), `new Map([])`);

  // Set
  const mySet = new Set<unknown>([
    "value1",
    2,
    true,
    { b: "set value" },
    Symbol("setval"),
  ]);
  assertEquals(
    r.render("{{jsValue val}}", { val: mySet }),
    `new Set(["value1", 2, true, {"b": "set value"}, Symbol("setval")])`,
  );
  assertEquals(r.render("{{jsValue val}}", { val: new Set() }), `new Set([])`);

  // Date
  const myDate = new Date(Date.UTC(2024, 0, 20, 10, 30, 0, 123)); // 20 Jan 2024, 10:30:00.123 UTC
  const expectedDateStr = `new Date("${myDate.toISOString()}")`;
  assertEquals(r.render("{{jsValue val}}", { val: myDate }), expectedDateStr);

  // RegExp
  assertEquals(r.render("{{jsValue val}}", { val: /abc/gi }), "/abc/gi");
  assertEquals(r.render("{{jsValue val}}", { val: /xyz/m }), "/xyz/m");

  // Nested structures
  const nested = {
    arr: [new Map([[1, new Set([2, "s"])]])],
    obj: { date: new Date(0), rgx: /test/ },
  };
  const expectedNested =
    `{"arr": [new Map([[1, new Set([2, "s"])]])], "obj": {"date": new Date("1970-01-01T00:00:00.000Z"), "rgx": /test/}}`;
  assertEquals(r.render("{{jsValue val}}", { val: nested }), expectedNested);

  // Class instance with toJSON
  class MyClass {
    constructor(
      public x: number,
      public y: string,
      private z: boolean = true,
    ) {}
    toJSON(): unknown {
      return { xVal: this.x, yVal: this.y, type: "MyClassInstance" };
    }
  }
  const myInstance = new MyClass(10, "hello");
  assertEquals(
    r.render("{{jsValue val}}", { val: myInstance }),
    `{"xVal": 10, "yVal": "hello", "type": "MyClassInstance"}`,
  );

  // Object that stringifies to a primitive via toJSON
  class StringifiesToPrimitive {
    toJSON(): unknown {
      return "primitive_value";
    }
  }
  assertEquals(
    r.render("{{jsValue val}}", { val: new StringifiesToPrimitive() }),
    `"primitive_value"`,
  );

  class StringifiesToNumber {
    toJSON(): unknown {
      return 12345;
    }
  }
  assertEquals(
    r.render("{{jsValue val}}", { val: new StringifiesToNumber() }),
    `12345`,
  );
});
