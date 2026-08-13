import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/**/*.ts", "!src/**/*.test.ts"],
  target: false,
  unbundle: true,
  deps: {
    skipNodeModulesBundle: true,
  },
  external: [/^cloudflare:/],
  sourcemap: false,
});
