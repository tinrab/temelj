# Inspect lint findings

Capture the repository diagnostics with `pnpm run lint --format json > /tmp/temelj-lint.json`.
The command exits unsuccessfully while lint findings remain.

Run `node scripts/oxlint/report.mjs /tmp/temelj-lint.json` to count findings by rule and package.
Append a path prefix to print individual diagnostics, for example
`node scripts/oxlint/report.mjs /tmp/temelj-lint.json packages/value/`.
An optional third argument filters rule names.

The vendored plugin's source and configuration are recorded in
[anti-slop/UPSTREAM.md](./anti-slop/UPSTREAM.md).

## Expand optional workflow fields

The scoped codemod in `packages/workflow/scripts-expand-optional-fields.mjs` expands
conditional object spreads into explicit conditionals. It handles typed return
objects and local declarations, including required fields between optional fields.
It also handles nested optional branches and optional summary objects. Spreads
from the workflow collection helpers are supported when their key is a safe
string literal and their imported name is not shadowed. It preserves property evaluation order and omission,
and checks added fields against the declared contract. Objects with accessors,
prototype setters, or comments in the rewritten portion are left for manual review.

Preview with `node packages/workflow/scripts-expand-optional-fields.mjs <files...>`,
or add `--write` to apply. Repeated runs leave migrated files unchanged. Run
`node --test packages/workflow/scripts-expand-optional-fields.test.mjs` to check
property omission, evaluation order, overwrites, and repeated execution.
