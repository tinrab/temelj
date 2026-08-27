import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/**/*.{ts,tsx}", "!src/**/*.test.{ts,tsx}"],
  target: false,
  unbundle: true,
  sourcemap: false,
});
