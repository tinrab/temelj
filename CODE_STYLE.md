# TypeScript Code Style

This is the strict TypeScript style guide for Temelj. It applies to all
hand-written TypeScript in `packages/*`, `lib/`, `scripts/`, and examples.
Generated files are governed by their generators.

## Source of Truth

- `pnpm format` is the formatting authority.
- `pnpm lint` is the lint authority.
- `pnpm typecheck` is the type authority.
- Code style that is not mechanically enforced is still required for review.

## Language Baseline

- Write ESM TypeScript only.
- Target modern JavaScript and keep TypeScript erasable under
  `erasableSyntaxOnly`.
- Do not use legacy `enum`, runtime `namespace`, parameter properties, decorators,
  or TypeScript-only runtime constructs.
- Use string literal unions, `as const` objects, discriminated unions, and
  ordinary classes/functions instead of non-erasable TypeScript features.
- Prefer `const`. Use `let` only for values that are reassigned. Do not use `var`.
- Keep code ASCII unless the file already requires non-ASCII content or the value
  being represented requires it.

## Formatting

- Let `oxfmt` decide whitespace, wrapping, semicolons, and trailing commas.
- Use double quotes for strings.
- Use semicolons.
- Keep one logical statement per line.
- Do not manually align declarations with padding spaces.
- Keep comments concise and useful. Do not comment obvious assignments or
  self-explanatory control flow.

## Modules and Exports

- Prefer named exports for package source.
- Do not add default exports in package source. Default exports are acceptable in
  tool config files such as `tsdown.config.ts` and `vitest.config.ts`.
- Public modules are exported from `src/mod.ts` with `export *`.
- Don't write `index.ts` barrel modules, only write `mod.ts`.
- The aggregate package in `lib/` should only re-export packages that are part of
  `@tinrab/temelj`.
- Use `import type` or inline `type` imports for types that are erased at runtime.
- Keep imports grouped as external packages, workspace packages, then relative
  imports, with blank lines between groups when the file has multiple groups.
- Use `.ts` extension for relative imports within the same package.
  `allowImportingTsExtensions` is already enabled in common `tsconfig.json`.
- Do not rewrite import specifiers just for style. Match the local package's
  existing relative import suffix convention.
- Avoid deep imports across package boundaries. Import from `@temelj/<name>`
  unless the package intentionally exposes a subpath.

## Public API Design

- Backwards compatibility is not required for new versions. Change public APIs
  when a different shape produces a cleaner design.
- Do not preserve old API shapes with temporary migration shims, deprecated
  aliases, compatibility layers, or version-bridging code unless explicitly
  requested.
- Exported functions and methods must have explicit return types unless the value
  is an immediately obvious constant.
- Public option objects should be named interfaces or type aliases.
- Prefer options objects once a function has more than two optional parameters or
  when booleans would make call sites ambiguous.
- Preserve literal inference for public builders and schema helpers with `const`
  type parameters where it materially improves user types.
- Use `readonly` for returned arrays, tuple-like data, and object fields that
  callers must not mutate.
- Keep public result shapes stable and discriminated. Existing result values use
  `kind` discriminants such as `"ok"` and `"error"`.
- Throw for programmer errors and invalid required state. Return `Result` for
  recoverable validation or operation failures when the surrounding package uses
  that style.

## Types

- Prefer `unknown` over `any`.
- `any` is allowed only at narrow interop boundaries where the upstream type is
  genuinely untyped or unsafely typed. Keep it local and add a short reason when
  the reason is not obvious.
- Avoid double assertions. If `as unknown as T` is required for a fluent builder,
  test mock, or external-library bridge, isolate it in a helper or a single
  expression.
- Do not use non-null assertions unless a nearby invariant proves the value is
  present. Prefer explicit checks.
- Keep generic constraints meaningful. Do not add generic parameters that are
  only aliases for `unknown`.
- Prefer type guards and discriminated unions over broad casts.
- Use overloads when they make a public API's input/output relationship precise.
  Keep overload implementations narrow and tested.
- Use `@ts-expect-error` only in tests or unavoidable interop code, and include a
  same-line or adjacent comment explaining the expected error.
- Do not use `@ts-ignore`.

## Runtime Code

- Prefer small pure functions for transformations and stateless utilities.
- Use classes when they model stateful runtime objects, custom errors, queues,
  builders, iterators, registries, or browser resources.
- Do not mutate caller-provided objects unless the API explicitly documents
  mutation.
- Use early returns for guard clauses.
- Keep error messages actionable and specific.
- Clean up event listeners, timers, abort handlers, observers, and subscriptions.
- For async APIs, support `AbortSignal` when cancellation is part of the expected
  workflow.
- Do not hide global state behind module initialization. Make state explicit.

## React Hooks

- React code belongs in packages or modules whose public surface is explicitly
  React-oriented.
- Hook exports must start with `use`.
- Keep hooks SSR-safe. Guard browser-only APIs with the package's existing
  `isBrowser` utilities or equivalent checks.
- Keep returned callbacks stable with `React.useCallback` when consumers are
  expected to pass them to effects, children, or event listeners.
- Use refs for latest callback/value patterns when timers, observers, or event
  listeners outlive a render.
- Mock browser APIs in colocated jsdom tests instead of assuming the runtime
  provides them.

## Tests

- Tests are colocated in `src/` as `*.test.ts`.
- Use Vitest imports explicitly.
- Name tests by observable behavior, not implementation details.
- Cover success, failure, edge cases, and type contracts for public APIs.
- Use `expectTypeOf` for compile-time public type guarantees.
- Keep tests deterministic. Use fake timers or controlled promises for timers,
  retries, throttling, debouncing, and concurrent work.
- Do not assert on generated implementation details unless the generated contract
  is the feature under test.

## Generated Code

- Do not hand-edit committed generated outputs.
- Change the generator first, regenerate, then review the generated diff.
- Generated files may have wider types, larger tables, and generated comments
  that would be inappropriate in hand-written source.

## Dependencies

- Prefer existing package utilities over adding new dependencies.
- Add runtime dependencies only to the package that imports them.
- Use `workspace:*` for internal package dependencies in `package.json`.
- Keep JSR import mappings in `deno.json` aligned with package dependencies only for workspace packages.

## Documentation

- Public API changes should update the package README when the user-facing usage
  changes.
- JSDoc should explain public behavior, parameters, return values, thrown errors,
  or tricky invariants. It should not restate the function name.
- Keep examples compilable ESM TypeScript.
