import { describe, expect, expectTypeOf, test } from "vitest";

import { parseViteEnv, type ViteEnv } from "./mod";

describe("vite preset", () => {
  test("parses Vite built-in environment variables", () => {
    const env = parseViteEnv({
      env: {
        BASE_URL: "/",
        MODE: "development",
        DEV: true,
        PROD: false,
        SSR: false,
      },
    });

    expect(env).toEqual({
      BASE_URL: "/",
      MODE: "development",
      DEV: true,
      PROD: false,
      SSR: false,
    });
    expectTypeOf(env).toEqualTypeOf<Readonly<ViteEnv>>();
  });
});
