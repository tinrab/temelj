import { build, emptyDir, type PackageJson } from "jsr:@deno/dnt@^0.41.3";
import path from "node:path";
import { z } from "npm:zod@3.23.8";
import { yellow } from "jsr:@std/fmt/colors";

const denoWorkspaceSchema = z.object({
  workspace: z.array(z.string()),
});
type DenoWorkspace = z.infer<typeof denoWorkspaceSchema>;

const denoMemberSchema = z.object({
  name: z.string(),
  description: z.string(),
  license: z.string(),
  version: z.string(),
  imports: z.record(z.string()).default({}),
  exports: z.record(z.string()),
});
type DenoMember = z.infer<typeof denoMemberSchema>;

type WorkspaceMember = {
  path: string;
  deno: DenoMember;
  packageJson?: PackageJson;
};

const NPM_PATH = path.resolve("./npm");

if (import.meta.main) {
  await emptyDir(NPM_PATH);

  const workspace: DenoWorkspace = denoWorkspaceSchema.parse(JSON.parse(
    await Deno.readTextFile("./deno.json"),
  ));
  const members = await readMembers(workspace);

  checkPackageDependencies(members);

  for (const member of members) {
    await buildMember(member);
  }
}

async function readMembers(
  workspace: DenoWorkspace,
): Promise<WorkspaceMember[]> {
  const members: WorkspaceMember[] = [];

  for (const workspacePath of workspace.workspace) {
    const deno: DenoMember = denoMemberSchema.parse(JSON.parse(
      await Deno.readTextFile(path.join(workspacePath, "deno.json")),
    ));

    let packageJson: PackageJson | undefined;
    try {
      packageJson = JSON.parse(
        await Deno.readTextFile(path.join(workspacePath, "package.json")),
      );
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }

    members.push({ path: workspacePath, deno, packageJson });
  }

  return members;
}

async function buildMember(member: WorkspaceMember) {
  const outputPath = path.join(NPM_PATH, member.deno.name);

  await build({
    entryPoints: Object.entries(member.deno.exports).map((
      [exportName, exportPath],
    ) => ({
      name: exportName,
      path: path.join(member.path, exportPath),
      kind: "export",
    })),
    outDir: outputPath,
    shims: {
      deno: true,
    },
    typeCheck: false,
    test: false,
    scriptModule: false,
    declaration: "separate",
    importMap: path.join(member.path, "deno.json"),
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
    async postBuild() {
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

function checkPackageDependencies(members: WorkspaceMember[]) {
  const versions = members.reduce((versions, member) => {
    versions[member.deno.name] = member.deno.version;
    return versions;
  }, {} as Record<string, string>);

  for (const member of members) {
    for (
      const [name, version] of Object.entries(
        member.packageJson?.dependencies || {},
      )
    ) {
      const packageVersion = version.replace(/^[\^~]/, "");
      const latestVersion = versions[name];
      if (packageVersion !== latestVersion) {
        // deno-lint-ignore no-console
        console.log(
          yellow(
            `Package '${name}' (${member.path}) is outdated '${version}', latest version is '${latestVersion}'`,
          ),
        );
      }
    }
  }
}
