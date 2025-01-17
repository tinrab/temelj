import { defineCommand, runMain } from "npm:citty@0.1.6";

import { updateVersions } from "./update_versions.ts";
import { buildNpm } from "./npm_build.ts";

const updateVersionsCommand = defineCommand({
  meta: {
    name: "update-versions",
  },
  run: updateVersions,
});

const buildNpmCommand = defineCommand({
  meta: {
    name: "npm-build",
  },
  run: buildNpm,
});

const cleanCommand = defineCommand({
  meta: {
    name: "clean",
  },
  async run(): Promise<void> {
    try {
      await Deno.remove("npm", { recursive: true });
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return;
      }
    }
  },
});

const main = defineCommand({
  meta: {
    name: "script",
  },
  subCommands: {
    "update-versions": updateVersionsCommand,
    "npm-build": buildNpmCommand,
    clean: cleanCommand,
  },
});

if (import.meta.main) {
  await runMain(main);
}
