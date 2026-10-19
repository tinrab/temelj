import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/**/*.{ts,tsx}", "!src/**/*.test.{ts,tsx}"],
  target: false,
  unbundle: true,
  // Unbundled output preserves each module's "use client" directive.
  checks: { moduleLevelDirective: false },
  sourcemap: false,
});
