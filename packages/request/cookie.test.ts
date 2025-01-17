import {
  decryptCookieValue,
  encryptCookieValue,
  parseCookie,
  parseCookieHeader,
  parseEncryptedCookie,
  serializeCookie,
  serializeCookieHeader,
  serializeEncryptedCookie,
} from "./cookie.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";

Deno.test("request - cookie - serialize", async () => {
  assertEquals(
    serializeCookie({
      name: "test",
      value: "42",
      domain: "flinect.com",
      expires: new Date("2024-01-01"),
      httpOnly: true,
      maxAge: 42,
      path: "/",
      priority: "high",
      sameSite: "lax",
      secure: true,
      partitioned: true,
    }),
    "test=42; Expires=Mon, 01 Jan 2024 00:00:00 GMT; Max-Age=42; Domain=flinect.com; Path=/; Secure; HttpOnly; SameSite=Lax; Priority=high;; Partitioned;",
  );

  assertRejects(
    () =>
      serializeEncryptedCookie(
        { name: "test", value: "42" },
        {
          password: "abc",
        },
      ),
    Error,
    "Password must be",
  );

  assert(
    !(
      await serializeEncryptedCookie(
        { name: "test", value: "super secure" },
        {
          password: "a".repeat(32),
        },
      )
    ).includes("super secure"),
  );
});

Deno.test("request - cookie - parse", () => {
  assertEquals(
    parseCookie(
      "test=42; Expires=Mon, 01 Jan 2024 00:00:00 GMT; Max-Age=42; Domain=flinect.com; Path=/; HttpOnly; SameSite=Lax; Priority=high; Partitioned;",
    ),
    {
      name: "test",
      value: "42",
      domain: "flinect.com",
      expires: new Date("2024-01-01"),
      httpOnly: true,
      maxAge: 42,
      path: "/",
      priority: "high",
      sameSite: "lax",
      partitioned: true,
    },
  );

  assertEquals(
    parseCookie(
      "test=42; Max-Age=0; Secure=true; SameSite=lax; Partitioned=true;",
    ),
    {
      name: "test",
      value: "42",
      maxAge: 0,
      sameSite: "lax",
      secure: true,
      partitioned: true,
    },
  );
});

Deno.test("request - cookie - encrypt", async () => {
  const password = "a".repeat(32);

  let c = await encryptCookieValue("hello", { password });
  assert(!c.includes("hello"));
  assertEquals(await decryptCookieValue(c, { password }), "hello");
  assertEquals(c.split("|").length, 6);
  assert(c.split("|").every((s) => s.trim().length !== 0));

  c = await encryptCookieValue("abc", { password });
  assert(await decryptCookieValue(c, { password }));
  assert(!(await decryptCookieValue(c, { password: "b".repeat(32) })));
  assert(
    !(await decryptCookieValue(`${c.substring(0, 5)}x${c.substring(7)}`, {
      password,
    })),
  );

  assertEquals(
    await parseEncryptedCookie(
      await serializeEncryptedCookie(
        { name: "test", value: "42" },
        {
          password,
        },
      ),
      { password },
    ),
    {
      name: "test",
      value: "42",
    },
  );
});

Deno.test("request - cookie - headers", () => {
  assertEquals(parseCookieHeader("a=42; b=13"), [
    {
      name: "a",
      value: "42",
    },
    {
      name: "b",
      value: "13",
    },
  ]);

  assertEquals(
    serializeCookieHeader([
      {
        name: "a",
        value: "42",
        secure: true,
        httpOnly: false,
      },
      {
        name: "b",
        value: "13",
      },
    ]),
    "a=42; b=13",
  );
});
