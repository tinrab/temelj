import type { PackageJson } from "jsr:@deno/dnt@~0.41.3";
import jsonc from "npm:jsonc-parser@3.3.1";
import path from "node:path";

import {
  readWorkspace,
  readWorkspaceMembers,
  updateMemberVersion,
} from "./utility.ts";

if (import.meta.main) {
  const packageJson: PackageJson = jsonc.parse(
    await Deno.readTextFile("./lib/package.json"),
  );

  const members = (await readWorkspaceMembers(await readWorkspace())).filter((
    member,
  ) => !member.deno.name.startsWith("@flinect"));

  const versions: Record<string, string> = {};

  for (const member of members) {
    const latestVersion = packageJson.dependencies?.[member.deno.name];
    if (!latestVersion) {
      continue;
    }

    const versionNumber = latestVersion.replaceAll(/^[\^~]+/g, "");
    if (versionNumber !== member.deno.version) {
      await updateMemberVersion(member, versionNumber);
    }

    versions[member.deno.name] = versionNumber;
    member.deno.version = versionNumber;
  }

  for (
    const member of members
  ) {
    if (member.packageJson?.dependencies === undefined) {
      continue;
    }

    let updatePackageJson = false;
    for (
      const [name, version] of Object.entries(member.packageJson.dependencies)
    ) {
      const packageVersion = version.replace(/^[\^~]/, "");
      const latestVersion = versions[name];
      if (!latestVersion) {
        continue;
      }

      if (packageVersion !== latestVersion) {
        member.packageJson.dependencies[name] = `^${latestVersion}`;
        updatePackageJson = true;
      }
    }

    if (updatePackageJson) {
      await Deno.writeTextFile(
        path.join(member.path, "package.json"),
        JSON.stringify(member.packageJson, null, 2),
      );
    }
  }
}
