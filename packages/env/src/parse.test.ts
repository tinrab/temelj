import { ok, unwrap, unwrapErr } from "@temelj/result";
import { describe, expect, expectTypeOf, test } from "vitest";
import { z } from "zod";

import {
  createEnv,
  createEnvAsync,
  EnvConfigurationError,
  EnvValidationError,
  normalizeEnv,
  parseEnv,
  parseEnvAsync,
  tryCreateEnv,
  tryCreateEnvAsync,
  tryParseEnv,
  tryParseEnvAsync,
} from "./mod";

describe("tryParseEnv", () => {
  test("parses a Standard Schema dictionary into a typed result", () => {
    const result = tryParseEnv(
      {
        PORT: z.coerce.number().default(3000),
        NODE_ENV: z.enum(["development", "production"]),
      },
      { env: { PORT: " 4000 ", NODE_ENV: " production " } },
    );

    expect(result).toEqual(ok({ PORT: 4000, NODE_ENV: "production" }));

    const env = unwrap(result);
    expectTypeOf(env.PORT).toEqualTypeOf<number>();
    expectTypeOf(env.NODE_ENV).toEqualTypeOf<"development" | "production">();
  });

  test("coerces boolean strings before validation", () => {
    const result = tryParseEnv(
      {
        FEATURE_ENABLED: z.boolean(),
        FEATURE_DISABLED: z.boolean(),
      },
      { env: { FEATURE_ENABLED: "true", FEATURE_DISABLED: " FALSE " } },
    );

    expect(result).toEqual(ok({ FEATURE_ENABLED: true, FEATURE_DISABLED: false }));
  });

  test("treats empty strings as undefined by default", () => {
    const result = tryParseEnv(
      {
        HOST: z.string().default("localhost"),
      },
      { env: { HOST: "   " } },
    );

    expect(result).toEqual(ok({ HOST: "localhost" }));
  });

  test("can preserve empty strings", () => {
    const result = tryParseEnv(
      {
        HOST: z.literal(""),
      },
      { env: { HOST: "   " }, emptyStringAsUndefined: false },
    );

    expect(result).toEqual(ok({ HOST: "" }));
  });

  test("returns validation errors instead of throwing", () => {
    const result = tryParseEnv(
      {
        PORT: z.coerce.number().int().positive(),
        NODE_ENV: z.enum(["development", "production"]),
      },
      { env: { PORT: "-1", NODE_ENV: "staging" } },
    );

    const error = unwrapErr(result);
    expect(error).toBeInstanceOf(EnvValidationError);
    expect((error as EnvValidationError).issues.map((issue) => issue.variable)).toEqual([
      "PORT",
      "NODE_ENV",
    ]);
    expect((error as EnvValidationError).issues[0].path).toEqual(["PORT"]);
  });

  test("returns configuration errors for async schemas in sync parsing", () => {
    const result = tryParseEnv(
      {
        TOKEN: z.string().refine(async () => true),
      },
      { env: { TOKEN: "abc" } },
    );

    expect(unwrapErr(result)).toBeInstanceOf(EnvConfigurationError);
  });

  test("supports async schemas with tryParseEnvAsync", async () => {
    const result = await tryParseEnvAsync(
      {
        TOKEN: z.string().refine(async (value) => value === "abc"),
      },
      { env: { TOKEN: "abc" } },
    );

    expect(result).toEqual(ok({ TOKEN: "abc" }));
  });
});

describe("parseEnv", () => {
  test("returns parsed values directly", () => {
    const env = parseEnv(
      {
        PORT: z.coerce.number(),
      },
      { env: { PORT: "4000" } },
    );

    expect(env).toEqual({ PORT: 4000 });
    expectTypeOf(env.PORT).toEqualTypeOf<number>();
  });

  test("throws validation errors", () => {
    expect(() =>
      parseEnv(
        {
          PORT: z.coerce.number().positive(),
        },
        { env: { PORT: "-1" } },
      ),
    ).toThrow(EnvValidationError);
  });

  test("returns async parsed values directly", async () => {
    await expect(
      parseEnvAsync(
        {
          TOKEN: z.string().refine(async (value) => value === "abc"),
        },
        { env: { TOKEN: "abc" } },
      ),
    ).resolves.toEqual({ TOKEN: "abc" });
  });
});

describe("createEnv", () => {
  test("parses server, client, and shared schemas on the server", () => {
    const env = createEnv({
      server: {
        DATABASE_URL: z.string().url(),
      },
      client: {
        VITE_API_URL: z.string().url(),
      },
      shared: {
        NODE_ENV: z.enum(["development", "production", "test"]),
      },
      clientPrefix: "VITE_",
      isServer: true,
      env: {
        DATABASE_URL: " https://db.rabzelj.com ",
        VITE_API_URL: "https://api.rabzelj.com",
        NODE_ENV: "test",
      },
    });

    expect(env).toEqual({
      DATABASE_URL: "https://db.rabzelj.com",
      VITE_API_URL: "https://api.rabzelj.com",
      NODE_ENV: "test",
    });
  });

  test("does not return server variables on the client", () => {
    const env = createEnv({
      server: {
        DATABASE_URL: z.string(),
      },
      client: {
        VITE_API_URL: z.string(),
      },
      shared: {
        NODE_ENV: z.enum(["development", "production", "test"]),
      },
      clientPrefix: "VITE_",
      isServer: false,
      env: {
        DATABASE_URL: "secret",
        VITE_API_URL: "public",
        NODE_ENV: "test",
      },
    });

    expect(env).toEqual({ VITE_API_URL: "public", NODE_ENV: "test" });
    expectTypeOf(env).not.toHaveProperty("DATABASE_URL");
  });

  test("rejects invalid client prefixes", () => {
    expect(() =>
      createEnv({
        client: {
          // @ts-expect-error API_URL is intentionally unprefixed for runtime validation.
          API_URL: z.string(),
        },
        clientPrefix: "VITE_",
        env: { API_URL: "https://rabzelj.com" },
      }),
    ).toThrow(EnvConfigurationError);
  });

  test("requires a clientPrefix when client schema is provided", () => {
    expect(() =>
      createEnv({
        client: {
          VITE_API_URL: z.string(),
        },
        env: { VITE_API_URL: "https://rabzelj.com" },
      }),
    ).toThrow(EnvConfigurationError);
  });

  test("supports async createEnv parsing", async () => {
    const env = await createEnvAsync({
      client: {
        VITE_TOKEN: z.string().refine(async (value) => value === "abc"),
      },
      clientPrefix: "VITE_",
      isServer: false,
      env: { VITE_TOKEN: "abc" },
    });

    expect(env).toEqual({ VITE_TOKEN: "abc" });
  });
});

describe("tryCreateEnv", () => {
  test("returns a result for grouped env parsing", () => {
    const result = tryCreateEnv({
      client: {
        VITE_API_URL: z.string(),
      },
      clientPrefix: "VITE_",
      isServer: false,
      env: { VITE_API_URL: "public" },
    });

    expect(result).toEqual(ok({ VITE_API_URL: "public" }));
  });

  test("returns configuration errors instead of throwing", () => {
    const result = tryCreateEnv({
      client: {
        VITE_API_URL: z.string(),
      },
      env: { VITE_API_URL: "https://rabzelj.com" },
    });

    expect(unwrapErr(result)).toBeInstanceOf(EnvConfigurationError);
  });

  test("supports async grouped env parsing", async () => {
    const result = await tryCreateEnvAsync({
      client: {
        VITE_TOKEN: z.string().refine(async (value) => value === "abc"),
      },
      clientPrefix: "VITE_",
      isServer: false,
      env: { VITE_TOKEN: "abc" },
    });

    expect(result).toEqual(ok({ VITE_TOKEN: "abc" }));
  });
});

describe("normalizeEnv", () => {
  test("normalizes only requested keys", () => {
    expect(normalizeEnv({ A: " true ", B: " untouched " }, ["A"])).toEqual({ A: true });
  });
});
