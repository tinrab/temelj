import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/**/*.ts", "!src/**/*.test.ts"],
  outDir: "./dist",
  target: "esnext",
  unbundle: true,
  sourcemap: false,
  outExtensions: () => ({
    js: ".js",
    dts: ".d.ts",
  }),
});
