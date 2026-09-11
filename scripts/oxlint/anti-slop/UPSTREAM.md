# Anti-slop provenance

Installed on 2026-09-10 from the local `install-anti-slop` skill bundle at
`/home/tin/.agents/skills/install-anti-slop/assets/anti-slop/`, using the skill's
`scripts/install.mjs` command.

The source repository and source commit are unknown. The supplied skill has no
Git metadata or top-level provenance record. No upstream revision is inferred
from the dependency version or the nested ESLint Stylistic record.

All 38 supplied files were copied byte-for-byte. This file is the only addition
inside the installed directory. The initial installation diff preserves those
pristine files for future comparisons once committed.

The SHA-256 of the source file manifest is
`9050bd7830cd83b9ff9c3540b84ba0b74896a7f457a0d993b60cab59436faa3c`.
The manifest sorts relative file paths and records each file as
`<SHA-256 of file bytes><two spaces><relative path><LF>`.
It excludes this added `UPSTREAM.md` and includes the nested vendor record.
The digest identifies the supplied bytes but cannot reconstruct a missing copy.

## Installed configuration

- Generic entry point: `scripts/oxlint/anti-slop/index.ts`.
- Optional Effect entry point: `scripts/oxlint/anti-slop/effect/index.ts`.
  It is copied but disabled because no workspace manifest declares `effect`.
- `.oxlintrc.json` enables all 18 generic rules and native
  `oxc/no-accumulating-spread` at `error` severity.
- `.oxlintrc.json` and `.oxfmtrc.json` exclude the vendored directory and local
  agent tooling directories.
- Root development dependencies `oxlint` and `@oxlint/plugins` are both pinned
  to `1.80.0`.

The user approved `allowInTypeGuards: true` for `packages/value/src/check.ts`
and `packages/value/src/promise.ts` during source cleanup. Other files retain
the default runtime `typeof` policy.

The user also approved boundary exceptions for arbitrary-value inspection APIs.
`equal.ts`, `size.ts`, and `ops.ts` in `packages/value/src/` allow unknown and object
parameters because their algorithms inspect arbitrary JavaScript values. The
private property reader in `size.ts` has a documented exception for its unknown
return value.

The user approved narrow parser-input exceptions during source cleanup.
Standard Schema validator inputs, including the Handlebars helper adapter, and MDX
YAML/TOML, JSON metadata, and transport validators have documented inline exceptions. The dedicated Unified tree and
runtime adapters allow unknown parameters while validating plugin output into
typed MDX and HTML nodes. Their output contracts remain checked. Workflow persistence, error-detail, and Cloudflare transport parsers also use inline
unknown-input exceptions and return validated domain values. These parser
exceptions do not disable the runtime `typeof` rule.

There are no rule implementation changes. The nested
[ESLint Stylistic provenance](./vendor/eslint-stylistic/UPSTREAM.md) and
[license](./vendor/eslint-stylistic/LICENSE) are preserved verbatim. Test paths
and repository commands in that nested record refer to the source project;
the skill bundle does not include those tests.
