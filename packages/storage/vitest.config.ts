import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    tags: [
      {
        name: "container",
        description: "Tests that start service containers via testcontainers.",
        timeout: 120000,
      },
    ],
  },
});
