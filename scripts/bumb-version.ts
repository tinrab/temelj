import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { defineCommand, runMain } from "citty";

const PATHS = {
  root: join(import.meta.dirname, ".."),
  packagesDir: "packages",
  umbrellaDir: "lib",
  examplesDir: "examples",
};

type PackageType = "child" | "umbrella" | "example";

interface ProjectInfo {
  name: string;
  path: string;
  type: PackageType;
  pkgJsonPath?: string;
  denoJsonPath?: string;
}

const main = defineCommand({
  meta: {
    name: "bump",
    version: "1.0.0",
    description: "Bump versions for @temelj workspace packages",
  },
  args: {
    root: {
      type: "string",
      description: "Target version for the umbrella package (@tinrab/temelj)",
      required: true,
    },
    child: {
      type: "string",
      description: "Target version for child packages (@temelj/*)",
      required: true,
    },
    filter: {
      type: "string",
      description:
        "Comma-separated list of child package names to bump (e.g. 'color,value')",
      required: false,
    },
    dryRun: {
      type: "boolean",
      description: "Log changes without writing to files",
      default: false,
    },
  },
  async run({ args }) {
    const rootVersion = args.root;
    const childVersion = args.child;
    const filters = args.filter
      ? args.filter.split(",").map((f) => f.trim())
      : [];
    const isDryRun = args.dryRun;

    console.log(`Bumping versions...`);
    console.log(`Umbrella: ${rootVersion}`);
    console.log(`Children: ${childVersion}`);
    if (filters.length > 0) console.log(`Filter: ${filters.join(", ")}`);

    const projects = await scanWorkspace();

    const versionUpdates = new Map<string, string>();

    for (const project of projects) {
      if (project.type === "umbrella") {
        versionUpdates.set(project.name, rootVersion);
      } else if (project.type === "child") {
        const shortName = project.name.replace("@temelj/", "");

        if (filters.length === 0 || filters.includes(shortName)) {
          versionUpdates.set(project.name, childVersion);
        }
      }
    }

    for (const project of projects) {
      if (project.pkgJsonPath) {
        await processPackageJson(
          project.pkgJsonPath,
          project.name,
          versionUpdates,
          isDryRun,
        );
      }

      if (project.denoJsonPath) {
        await processDenoJson(
          project.denoJsonPath,
          project.name,
          versionUpdates,
          isDryRun,
        );
      }
    }

    console.log("Bump complete!");
  },
});

async function processPackageJson(
  filePath: string,
  pkgName: string,
  versionUpdates: Map<string, string>,
  dryRun: boolean,
) {
  const content = await readFile(filePath, "utf-8");
  const json = JSON.parse(content);
  let changed = false;

  if (versionUpdates.has(pkgName)) {
    const newVer = versionUpdates.get(pkgName);
    if (json.version !== newVer) {
      console.log(
        `[package.json] Updating ${pkgName} version: ${json.version} -> ${newVer}`,
      );
      json.version = newVer;
      changed = true;
    }
  }

  const depFields = ["dependencies", "devDependencies", "peerDependencies"];
  for (const field of depFields) {
    if (!json[field]) {
      continue;
    }

    for (const [depName, currentVal] of Object.entries(json[field])) {
      if (versionUpdates.has(depName)) {
        const newVer = versionUpdates.get(depName);

        if (
          typeof currentVal === "string" &&
          !currentVal.startsWith("workspace:")
        ) {
          const prefix = currentVal.match(/^[\^~]/)?.[0] || "^";
          const nextVal = `${prefix}${newVer}`;

          if (currentVal !== nextVal) {
            console.log(
              `[package.json] Updating dep in ${pkgName}: ${depName} -> ${nextVal}`,
            );
            json[field][depName] = nextVal;
            changed = true;
          }
        }
      }
    }
  }

  if (changed && !dryRun) {
    await writeJson(filePath, json);
  }
}

async function processDenoJson(
  filePath: string,
  pkgName: string,
  versionUpdates: Map<string, string>,
  dryRun: boolean,
) {
  const content = await readFile(filePath, "utf-8");
  const json = JSON.parse(content);
  let changed = false;

  if (versionUpdates.has(pkgName)) {
    const newVer = versionUpdates.get(pkgName);
    if (json.version !== newVer) {
      console.log(
        `[deno.json]    Updating ${pkgName} version: ${json.version} -> ${newVer}`,
      );
      json.version = newVer;
      changed = true;
    }
  }

  if (json.imports) {
    for (const [key, val] of Object.entries(json.imports)) {
      if (typeof val === "string" && val.startsWith("jsr:")) {
        for (const [updatePkg, updateVer] of versionUpdates) {
          if (val.includes(`jsr:${updatePkg}@`)) {
            const parts = val.split("@");

            if (parts.length >= 3) {
              const versionPart = parts[parts.length - 1];
              const modifier = versionPart.match(/^[\^~]/)?.[0] || "^";
              const newVal = `${parts.slice(0, -1).join("@")}@${modifier}${updateVer}`;

              if (val !== newVal) {
                console.log(
                  `[deno.json]    Updating import in ${pkgName}: ${updatePkg} -> ${modifier}${updateVer}`,
                );
                json.imports[key] = newVal;
                changed = true;
              }
            }
          }
        }
      }
    }
  }

  if (changed && !dryRun) {
    await writeJson(filePath, json);
  }
}

async function scanWorkspace(): Promise<ProjectInfo[]> {
  const projects: ProjectInfo[] = [];

  const libPath = resolve(PATHS.root, PATHS.umbrellaDir);
  if (existsSync(libPath)) {
    const pJson = join(libPath, "package.json");
    const dJson = join(libPath, "deno.json");
    const name = JSON.parse(await readFile(pJson, "utf-8")).name;
    projects.push({
      name,
      path: libPath,
      type: "umbrella",
      pkgJsonPath: existsSync(pJson) ? pJson : undefined,
      denoJsonPath: existsSync(dJson) ? dJson : undefined,
    });
  }

  const pkgsPath = resolve(PATHS.root, PATHS.packagesDir);
  if (existsSync(pkgsPath)) {
    const dirs = await readdir(pkgsPath, { withFileTypes: true });
    for (const dir of dirs) {
      if (dir.isDirectory()) {
        const fullPath = join(pkgsPath, dir.name);
        const pJson = join(fullPath, "package.json");
        const dJson = join(fullPath, "deno.json");

        if (!existsSync(pJson) && !existsSync(dJson)) {
          continue;
        }

        let name = "";
        if (existsSync(pJson)) {
          name = JSON.parse(await readFile(pJson, "utf-8")).name;
        } else if (existsSync(dJson)) {
          name = JSON.parse(await readFile(dJson, "utf-8")).name;
        }

        projects.push({
          name,
          path: fullPath,
          type: "child",
          pkgJsonPath: existsSync(pJson) ? pJson : undefined,
          denoJsonPath: existsSync(dJson) ? dJson : undefined,
        });
      }
    }
  }

  const examplesPath = resolve(PATHS.root, PATHS.examplesDir);
  if (existsSync(examplesPath)) {
    const categories = await readdir(examplesPath, { withFileTypes: true });
    for (const cat of categories) {
      if (!cat.isDirectory()) {
        continue;
      }
      const catPath = join(examplesPath, cat.name);
      const subDirs = await readdir(catPath, { withFileTypes: true });

      for (const sub of subDirs) {
        if (!sub.isDirectory()) {
          continue;
        }
        const fullPath = join(catPath, sub.name);
        const pJson = join(fullPath, "package.json");
        if (existsSync(pJson)) {
          const name = JSON.parse(await readFile(pJson, "utf-8")).name;
          projects.push({
            name,
            path: fullPath,
            type: "example",
            pkgJsonPath: pJson,
          });
        }
      }
    }
  }

  return projects;
}

async function writeJson(path: string, content: any) {
  await writeFile(path, JSON.stringify(content, null, 2));
}

runMain(main);
