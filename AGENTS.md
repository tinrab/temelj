# Temelj Agent Guide

These instructions apply to the whole repository.

## Project Shape

- Temelj is a TypeScript monorepo managed with `pnpm` workspaces and Turbo.
- The workspace contains the root package, `lib/`, `packages/*`, and `examples/**`.
- Source packages live in `packages/<name>/src`. Tests are colocated as `*.test.ts`.
- The aggregate package is `@tinrab/temelj` in `lib/`. It re-exports selected
  foundational packages from `lib/src/<name>/mod.ts`.
- Not every package belongs in the aggregate package. Some packages are
  intentionally imported directly as `@temelj/<name>` because they are optional,
  specialized, environment-specific, or otherwise not part of the foundational
  surface.

## Toolchain

- Package manager: `pnpm`. Use the version declared by `packageManager` in
  `package.json`.
- TypeScript runs with `strict: true`, `isolatedModules: true`, and
  `erasableSyntaxOnly: true`.
- Runtime/module format: ESM only. Every package uses `"type": "module"`.
- Build tool: `tsdown` with `unbundle: true`, `target: false`, and no source
  maps. This emits one output file per source file.
- Formatting: `oxfmt`.
- Linting: `oxlint --type-aware` with eslint, TypeScript, unicorn, react,
  react-perf, oxc, import, jsdoc, node, promise, and vitest plugins.
- Tests: Vitest. The root config runs `packages/**/*.test.ts` in the Node
  environment; package-local configs override this where needed.

## Common Commands

```sh
pnpm install
pnpm build
pnpm lint
pnpm lint:fix
pnpm typecheck
pnpm test
pnpm test:watch
pnpm dev
```

## Required Verification Order

Use the same order as CI when validating broad changes:

1. `pnpm build`
2. `pnpm typecheck`
3. `pnpm test`

For narrow documentation-only changes, a targeted inspection is usually enough.
For TypeScript changes, run the smallest meaningful package-level command first,
then broaden to the CI order when the change affects shared behavior, package
exports, build configuration, or cross-package contracts.

## Package Layout

Each package generally follows this layout:

```text
packages/<name>/
  src/
    mod.ts
    *.ts
    *.test.ts
  README.md
  deno.json
  package.json
  tsconfig.json
  tsdown.config.ts
```

Package conventions:

- `src/mod.ts` is the public barrel and should use `export *` for public modules.
- Tests stay next to the source they cover.
- `dist/` is build output and must not be edited by hand.
- Package `tsconfig.json` extends `../../scripts/tsconfig.json`.
- Package `tsdown.config.ts` should stay identical unless there is a package-specific
  reason to diverge.
- Package `deno.json` defines JSR/Deno source exports and publish include/exclude
  rules.

## Generated Files

Generated files are allowed only where the repository already has a committed
generation workflow.

- Prefer package-local generation scripts such as `script:generate` or similarly
  named commands when regenerating committed generated files.
- Do not hand-edit generated outputs except for emergency investigation.
- Do not introduce generated code in other packages without adding a committed,
  documented generation command.

## API Compatibility

Breaking API changes are allowed. This project does not require backwards
compatibility when publishing new versions.

- Prefer the cleanest current design over preserving an awkward old API.
- Public APIs may be renamed, reshaped, removed, or replaced when that improves
  the package.
- Do not add temporary migration shims, deprecated aliases, compatibility layers,
  or version-bridging code unless explicitly requested.
- Update tests, README examples, exports, and dependent packages to the new API
  directly.

## TypeScript Style

Follow [CODE_STYLE.md](./CODE_STYLE.md) for all TypeScript edits. The most
important constraints are:

- Use modern erasable TypeScript. Do not use legacy enums, runtime namespaces,
  parameter properties, or other syntax that conflicts with
  `erasableSyntaxOnly`.
- Prefer named exports. Package source should not introduce default exports;
  config files may use default exports where the tool expects them.
- Keep public APIs explicit: exported functions, methods, classes, interfaces,
  and type aliases should be intentionally named and typed.
- Use `unknown` instead of `any`. Any unsafe cast or `@ts-expect-error` needs a
  narrow reason at the use site.
- Avoid import/export churn. Match the local package's existing relative import
  suffix convention.
- Preserve ESM and unbundled-build compatibility. Do not rely on side effects or
  hidden module initialization for public APIs.

## Testing Guidelines

- Add or update colocated Vitest tests for behavior changes.
- Use package-local Vitest configs when they exist.
- Browser or React-oriented packages should keep browser APIs mocked in package
  test helpers instead of relying on ambient runtime behavior.
- Use `expectTypeOf` or intentional `@ts-expect-error` checks for public type
  contracts that runtime tests cannot prove.
- Tests should exercise public behavior through the package's normal API surface
  unless testing an intentionally internal helper.

## Publishing Notes

- NPM publish command from the root after CI passes:

```sh
pnpm publish -r --access public --no-git-checks
```

- JSR packages are published individually from package directories with
  `npx jsr publish`. See `.github/workflows/publish.yaml` for the authoritative
  publish list.

## Agent Workflow

- Read the local package before editing; follow nearby patterns over generic
  preferences.
- Keep changes scoped. Do not mix unrelated refactors, import rewrites, generated
  output, or metadata churn into a behavioral change.
- Do not edit `dist/`, package-local `node_modules/`, `.turbo/`, or lockfiles
  unless the task explicitly requires it.
- When adding a package, update workspace metadata, package exports, Deno config,
  README/docs, and `lib/` re-exports only when the package belongs in
  `@tinrab/temelj`.
- Preserve user work in a dirty tree. Never revert changes you did not make
  unless explicitly asked.
