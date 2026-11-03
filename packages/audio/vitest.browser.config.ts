import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const executablePath = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"];

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: {
          args: ["--autoplay-policy=no-user-gesture-required"],
          executablePath,
        },
      }),
      instances: [{ browser: "chromium" }],
    },
    include: ["src/**/*.browser.test.ts"],
  },
});
