# TypeScript Code Style

This is the strict TypeScript style guide for Temelj. It applies to all
hand-written TypeScript in `packages/*`, `lib/`, `scripts/`, and examples.
Generated files are governed by their generators.

## Source of Truth

- `pnpm lint` is the lint authority.
- `pnpm typecheck` is the type authority.
- Code style that is not mechanically enforced is still required for review.
- Encode recurring mechanical rules in types, lint rules, generators, or scripts.
  Reserve prose rules for decisions that require judgment.

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

- Use double quotes for strings.
- Use semicolons.
- Always use braces around `if`, `else`, `for`, `while`, and `do` bodies.
- Keep comments concise and useful. Do not comment obvious assignments or
  self-explanatory control flow.

## Modules and Exports

- Prefer named exports for package source.
- Do not add default exports in package source. Default exports are acceptable in
  tool config files such as `tsdown.config.ts` and `vitest.config.ts`.
- Export public modules from `src/mod.ts`. Use `export *` only when every export
  in the target module is public; otherwise export the supported symbols
  explicitly.
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
- Treat every export as maintained API. Keep normalization helpers, mutable state,
  adapters, decoder details, and internal context types private.
- Keep `package.json`, `deno.json`, build entries, and source barrels aligned.
  Each public subpath has one source entry and one declared export.

## Public API Design

- Backwards compatibility is not required for new versions. Change public APIs
  when a different shape produces a cleaner design.
- Do not preserve old API shapes with temporary migration shims, deprecated
  aliases, compatibility layers, or version-bridging code unless explicitly
  requested.
- Migrate all workspace callers in the same change, then delete the replaced API.
- Exported functions and methods must have explicit return types unless the value
  is an immediately obvious constant.
- Public option objects should be named interfaces or type aliases.
- Give each concept one canonical representation. Add separate input, resolved,
  or internal forms only when each form has a distinct invariant.
- Prefer options objects once a function has more than two optional parameters or
  when booleans would make call sites ambiguous.
- Preserve literal inference for public builders and schema helpers with `const`
  type parameters where it materially improves user types.
- Use `readonly` for returned arrays, tuple-like data, and object fields that
  callers must not mutate.
- Keep public result shapes stable and discriminated. Existing result values use
  `kind` discriminants such as `"ok"` and `"error"`.
- Model mutually exclusive options as a discriminated union. Do not expose
  objects whose invalid property combinations require runtime checks.
- In partial-update APIs, define omission and explicit clearing separately and
  encode that distinction consistently.
- Throw for programmer errors and invalid required state. Return `Result` for
  recoverable validation or operation failures when the surrounding package uses
  that style.

## Data Modeling and Ownership

- Values carry the semantic data described by their types. Do not hide required
  meaning in module-level `WeakMap` or `WeakSet` registries, out-of-band brands,
  CSS classes, or getters that recover a second representation.
- Use weak collections for ephemeral identity metadata such as cycle detection or
  provenance, not as the source of truth for an object's behavior.
- Translate external representations once at their boundary and use the canonical
  internal representation thereafter.
- Carry domain intent explicitly. Do not reconstruct it from presentation markup,
  class names, constructor identity, or other incidental runtime details.
- Keep representations separate when they have different trust, lifecycle, or
  execution semantics. Share their common operations, not their identities.

## Simplicity and Abstraction

- Prefer direct code over abstraction until the abstraction removes real
  duplication, names a domain concept, or protects a non-obvious invariant.
- Do not add pass-through helpers that only call another function, rename another
  predicate, or wrap a single `if` statement. Inline the check at the call site
  unless the helper has a stable domain meaning used in several places.
- Do not wrap `Object.freeze`, object construction, property access, error
  forwarding, or another primitive operation without adding a domain invariant.
- Do not create local aliases such as `isX()` when an existing `isX()` already
  expresses the same predicate. Import and use the existing function directly.
- Do not add "manager", "service", "engine", "api", "impl", or "utils" layers
  just to move code around. A layer should own state, isolate an external
  dependency, or define a real boundary.
- Move genuinely shared helpers to the narrowest common module after duplication
  exists. Do not create a generic `utils.ts` or `common.ts` drawer.
- Split large modules along stable responsibilities, ownership, or dependency
  boundaries, not at an arbitrary line count.
- Do not maintain parallel copies of the same algorithm for different backends or
  sync and async variants. Share the semantic core and isolate the true boundary
  differences.
- Use ordinary classes for stateful runtime implementations. If a public
  interface has an implementation, prefer `export class FooImpl implements Foo`
  with methods and public readonly properties over object-literal `api` shells
  or empty `interface FooImpl extends Foo {}` declarations.
- Do not keep old overloads, duck-typed input shapes, aliases, or forwarding
  wrappers after a cleaner API exists. Remove the old shape and update callers.
- If a function exists only to satisfy a past refactor and its body is still
  obvious at every call site, delete it.
- Before retaining an abstraction or compatibility path, find its callers. Delete
  code, exports, and state with no remaining consumer.

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
- A type guard must validate every fact in the type it claims. Do not use a broad
  object check to assert a structured domain type.
- Do not recreate a closed union with constructor arrays or repeated `instanceof`
  checks. Give variants a stable discriminant and use an exhaustive `switch`.
- Use overloads when they make a public API's input/output relationship precise.
  Keep overload implementations narrow and tested.
- Use `@ts-expect-error` only in tests or unavoidable interop code, and include a
  same-line or adjacent comment explaining the expected error.
- Do not use `@ts-ignore`.
- Do not use bracket access or a cast to bypass a class's visibility. Move the
  operation to the owning class or expose an intentional capability.

## Validation and Parsing

- Parser code uses character literals such as `"*"` and `"\\"`, named boundary
  constants, and semantic predicates. Do not use anonymous numeric character
  codes in grammar logic.

- TypeScript is the source of truth for values that are already typed inside the
  package. Do not parse, validate, or schema-check internal option objects merely
  to recover type safety that TypeScript already provides.
- Use runtime schemas for data that crosses an untyped boundary: user-provided
  unknown values, persisted storage records, serialized payloads, environment
  variables, wire formats, and plugin/compiler input.
- Validate a boundary value once, convert it to a trusted type, and do not repeat
  shape checks throughout internal code.
- When a schema is the runtime source of truth, colocate it with the type and
  infer the type from the schema when that keeps the contract clearer.
- Keep public validator interoperability through `@temelj/standard-schema` when
  accepting user schemas. Package internals may use the package's established
  runtime validator for its own persisted or external records.
- Reserve `parse*` names for functions that truly parse unknown, string,
  serialized, or external input and can reject malformed data. Do not name typed
  option normalization `parse*`; use `resolve*`, `normalize*`, or direct code.
- Avoid `assert*`, `validate*`, and `require*` helpers for one-off checks. Inline
  the condition and throw a named error. Keep these helpers only when they encode
  a reusable invariant or make a larger algorithm easier to read.
- Do not add a local generic `isRecord` helper. At an unknown-object boundary, use
  the repository's established value predicates, preferably from `@temelj/value`,
  then validate the required fields.
- Prefer existing structured helpers over custom equality and matching code. For
  example, use package utilities such as `deepEquals` when structural equality is
  the point, instead of writing local field-by-field matchers.

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
- Avoid conditional spreads that produce an empty object only to omit an optional
  value. Assign `undefined` directly unless property presence is meaningful.
- When the public contract permits both, preserve synchronous completion when a
  dependency returns a value. Do not mark a function `async` solely to normalize
  both paths.
- Freeze values only when observable immutability is part of the public contract
  or the same value crosses ownership boundaries. TypeScript `readonly` is enough
  for private implementation values.
- When a collection is searched repeatedly inside a loop, build an index with the
  correct lifetime instead of rescanning it. Keep readable one-off searches
  direct.

## Errors

- Custom error classes should expose named static constructors for common failure
  cases, following the `StorageKeyError.invalidFormat(...)` style. Call sites
  should read as the failure being reported, not as string formatting.
- Do not add generic error factories such as `WorkflowStepError.message(...)` or
  `OptionsError.fromMessage(...)`. If a failure is common enough for a factory,
  name the factory after the failure.
- Keep error messages specific and stable, but keep message construction inside
  the error class when the same failure can occur in multiple modules.
- Do not classify errors by parsing their messages. Use an explicit error type,
  discriminant, or control signal.
- Preserve structured details on errors when callers, logs, or serialized records
  need to inspect the failure programmatically.
- Construct base error classes directly only for record rehydration, tests, or
  truly open-ended user-supplied errors. Normal package code should throw the
  most specific error or named factory available.

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
- Keep render pure. Do not mutate refs, external state, streams, or stores during
  render, and do not execute extension hooks or plugin pipelines there.
- Perform effects in an effect, event handler, or external-store boundary.
  Memoized computation is not an effect boundary.
- Cancel obsolete asynchronous effect work when supported and ignore stale
  completions.
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
- Generated fixtures or artifacts need both a committed generator and a current
  consumer. Remove the workflow and its outputs together when the consumer is
  deleted.
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
- Remove stale examples, comments, export lists, and generated documentation in
  the same change that removes the code they describe.
