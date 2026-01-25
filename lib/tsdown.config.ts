import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/**/*.ts", "!src/**/*.test.ts"],
  outDir: "./dist",
  target: false,
  unbundle: true,
  sourcemap: false,
  dts: false,
  outExtensions: () => ({
    js: ".js",
    dts: ".d.ts",
  }),
});
