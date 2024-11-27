import { build, emptyDir } from "jsr:@deno/dnt@^0.41.3";
import path from "node:path";

import {
  checkPackageDependencies,
  readWorkspace,
  readWorkspaceMembers,
  type WorkspaceMember,
} from "./utility.ts";

const NPM_PATH = path.resolve("./npm");

export async function buildNpm(): Promise<void> {
  await emptyDir(NPM_PATH);

  const workspace = await readWorkspace();
  const members = await readWorkspaceMembers(workspace);

  checkPackageDependencies(members);

  for (const member of members) {
    await buildMember(member);
  }
}

async function buildMember(member: WorkspaceMember): Promise<void> {
  const outputPath = path.join(NPM_PATH, member.deno.name);

  await build({
    entryPoints: Object.entries(member.deno.exports).map(
      ([exportName, exportPath]) => ({
        name: exportName,
        path: path.join(member.path, exportPath),
        kind: "export",
      }),
    ),
    outDir: outputPath,
    shims: {
      deno: true,
    },
    typeCheck: false,
    test: false,
    scriptModule: false,
    declaration: "separate",
    skipNpmInstall: true,
    package: {
      name: member.deno.name,
      version: member.deno.version,
      description: member.deno.description,
      license: member.deno.license,
      repository: {
        type: "git",
        url: "git+https://github.com/flinect/temelj.git",
      },
      bugs: {
        url: "https://github.com/flinect/temelj/issues",
      },
      ...(member.packageJson ?? {}),
    },
    async postBuild(): Promise<void> {
      await Deno.copyFile("LICENSE", path.join(outputPath, "LICENSE"));

      for (const fileName of ["README.md"]) {
        try {
          await Deno.copyFile(
            path.join(member.path, fileName),
            path.join(outputPath, fileName),
          );
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) {
            throw error;
          }
        }
      }
    },
  });
}
