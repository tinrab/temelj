import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/**/*.ts", "!src/**/*.test.ts", "!src/testing/**"],
  target: false,
  unbundle: true,
  deps: {
    skipNodeModulesBundle: true,
  },
  external: [/^cloudflare:/],
  sourcemap: false,
});
