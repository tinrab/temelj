import { expect, test } from "vitest";

import {
  decryptCookieValue,
  encryptCookieValue,
  parseCookie,
  parseCookieHeader,
  parseEncryptedCookie,
  serializeCookie,
  serializeCookieHeader,
  serializeEncryptedCookie,
} from "./cookie";

test("request - cookie - serialize", async () => {
  expect(
    serializeCookie({
      name: "test",
      value: "42",
      domain: "tinrab.com",
      expires: new Date("2024-01-01"),
      httpOnly: true,
      maxAge: 42,
      path: "/",
      priority: "high",
      sameSite: "lax",
      secure: true,
      partitioned: true,
    }),
  ).toBe(
    "test=42; Expires=Mon, 01 Jan 2024 00:00:00 GMT; Max-Age=42; Domain=tinrab.com; Path=/; Secure; HttpOnly; SameSite=Lax; Priority=high;; Partitioned;",
  );

  await expect(() =>
    serializeEncryptedCookie(
      { name: "test", value: "42" },
      {
        password: "abc",
      },
    ),
  ).rejects.toThrow(Error);

  expect(
    !(
      await serializeEncryptedCookie(
        { name: "test", value: "super secure" },
        {
          password: "a".repeat(32),
        },
      )
    ).includes("super secure"),
  ).toBe(true);
});

test("request - cookie - parse", () => {
  expect(
    parseCookie(
      "test=42; Expires=Mon, 01 Jan 2024 00:00:00 GMT; Max-Age=42; Domain=tinrab.com; Path=/; HttpOnly; SameSite=Lax; Priority=high; Partitioned;",
    ),
  ).toStrictEqual({
    name: "test",
    value: "42",
    domain: "tinrab.com",
    expires: new Date("2024-01-01"),
    httpOnly: true,
    maxAge: 42,
    path: "/",
    priority: "high",
    sameSite: "lax",
    partitioned: true,
  });

  expect(
    parseCookie(
      "test=42; Max-Age=0; Secure=true; SameSite=lax; Partitioned=true;",
    ),
  ).toStrictEqual({
    name: "test",
    value: "42",
    maxAge: 0,
    sameSite: "lax",
    secure: true,
    partitioned: true,
  });
});

test("request - cookie - encrypt", async () => {
  const password = "a".repeat(32);

  let c = await encryptCookieValue("hello", { password });
  expect(!c.includes("hello")).toBe(true);
  expect(await decryptCookieValue(c, { password })).toBe("hello");
  expect(c.split("|").length).toBe(6);
  expect(c.split("|").every((s) => s.trim().length !== 0)).toBe(true);

  c = await encryptCookieValue("abc", { password });
  expect(await decryptCookieValue(c, { password })).toBe("abc");
  expect(!(await decryptCookieValue(c, { password: "b".repeat(32) }))).toBe(
    true,
  );
  expect(
    !(await decryptCookieValue(`${c.substring(0, 5)}x${c.substring(7)}`, {
      password,
    })),
  ).toBe(true);

  expect(
    await parseEncryptedCookie(
      await serializeEncryptedCookie(
        { name: "test", value: "42" },
        {
          password,
        },
      ),
      { password },
    ),
  ).toStrictEqual({
    name: "test",
    value: "42",
  });
});

test("request - cookie - headers", () => {
  expect(parseCookieHeader("a=42; b=13")).toStrictEqual([
    {
      name: "a",
      value: "42",
    },
    {
      name: "b",
      value: "13",
    },
  ]);

  expect(
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
  ).toBe("a=42; b=13");
});
