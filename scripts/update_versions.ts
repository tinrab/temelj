import type { PackageJson } from "jsr:@deno/dnt@~0.41.3";
import jsonc from "npm:jsonc-parser@3.3.1";
import path from "node:path";

import {
  type DenoMember,
  readWorkspace,
  readWorkspaceMembers,
} from "./utility.ts";

if (import.meta.main) {
  const packageJson: PackageJson = jsonc.parse(
    await Deno.readTextFile("./lib/package.json"),
  );

  const workspace = await readWorkspace();

  for (const member of await readWorkspaceMembers(workspace)) {
    const latestVersion = packageJson.dependencies?.[member.deno.name];
    if (!latestVersion) {
      continue;
    }

    const versionNumber = latestVersion.replaceAll(/^[\^~]+/g, "");
    if (versionNumber === member.deno.version) {
      continue;
    }

    const memberDenoPath = path.join(member.path, "deno.json");
    const memberDeno: DenoMember = jsonc.parse(
      await Deno.readTextFile(
        memberDenoPath,
      ),
    );
    memberDeno.version = versionNumber;

    await Deno.writeTextFile(
      memberDenoPath,
      JSON.stringify(memberDeno, null, 2),
    );
  }
}
