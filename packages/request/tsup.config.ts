import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["./src/**/*.ts", "!src/**/*.test.ts"],
  outDir: "./dist",
  target: "esnext",
  format: ["esm"],
  clean: true,
  dts: true,
  bundle: false,
});
