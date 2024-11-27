import { z } from "npm:zod@3.23.8";
import type { PackageJson } from "jsr:@deno/dnt@^0.41.3";
import path from "node:path";
import { yellow } from "jsr:@std/fmt/colors";
import jsonc from "npm:jsonc-parser@3.3.1";

export type { PackageJson };

export const denoWorkspaceSchema = z.object({
  workspace: z.array(z.string()),
});
export type DenoWorkspace = z.infer<typeof denoWorkspaceSchema>;

export const denoMemberSchema = z.object({
  name: z.string(),
  description: z.string(),
  license: z.string(),
  version: z.string(),
  imports: z.record(z.string()).default({}),
  exports: z.record(z.string()),
});
export type DenoMember = z.infer<typeof denoMemberSchema>;

export type WorkspaceMember = {
  path: string;
  deno: DenoMember;
  packageJson?: PackageJson;
};

export async function readWorkspace(): Promise<DenoWorkspace> {
  return denoWorkspaceSchema.parse(
    JSON.parse(await Deno.readTextFile("./deno.json")),
  );
}

export async function readWorkspaceMembers(
  workspace: DenoWorkspace,
): Promise<WorkspaceMember[]> {
  const members: WorkspaceMember[] = [];

  for (const workspacePath of workspace.workspace) {
    const deno: DenoMember = denoMemberSchema.parse(
      JSON.parse(
        await Deno.readTextFile(path.join(workspacePath, "deno.json")),
      ),
    );

    let packageJson: PackageJson | undefined;
    try {
      packageJson = JSON.parse(
        await Deno.readTextFile(path.join(workspacePath, "npm.json")),
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

export function checkPackageDependencies(members: WorkspaceMember[]): void {
  const versions = members.reduce(
    (versions, member) => {
      versions[member.deno.name] = member.deno.version;
      return versions;
    },
    {} as Record<string, string>,
  );

  for (const member of members) {
    for (
      const [name, version] of Object.entries(
        member.packageJson?.dependencies || {},
      )
    ) {
      if (!members.find((member) => member.deno.name === name)) {
        continue;
      }
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

export async function updateMemberVersion(
  member: WorkspaceMember,
  version: string,
): Promise<void> {
  const memberDenoPath = path.join(member.path, "deno.json");
  const memberDeno: DenoMember = jsonc.parse(
    await Deno.readTextFile(memberDenoPath),
  );
  memberDeno.version = version;

  await Deno.writeTextFile(memberDenoPath, JSON.stringify(memberDeno, null, 2));
}
