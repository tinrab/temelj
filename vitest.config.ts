import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    projects: [{}],
    exclude: ["**/node_modules/**", "**/thirdparty/**", "**/dist/**", "**/.{git,output}/**"],
  },
});
