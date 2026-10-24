# TypeScript Style Guide

The TypeScript style guide for Temelj, a library monorepo managed with pnpm workspaces and Turbo.

This guide governs handwritten source, tests, examples, scripts, and configuration in `packages/*`, `lib/`, `scripts/`, and `examples/**`. Generated and vendored files follow their source workflows. React guidance applies to React-oriented packages and examples, not to every library package.

The emphasis is code style: names, expressions, functions, types, modules, and the way behavior is made visible in source. File organization supports those goals without prescribing a particular application architecture.

## Contents

1. [Rules and scope](#1-rules-and-scope)
2. [Required language baseline](#2-required-language-baseline)
3. [Formatting and source text](#3-formatting-and-source-text)
4. [Naming](#4-naming)
5. [Files and directories](#5-files-and-directories)
6. [Modules and dependencies](#6-modules-and-dependencies)
7. [Imports and exports](#7-imports-and-exports)
8. [Variables and expressions](#8-variables-and-expressions)
9. [Control flow](#9-control-flow)
10. [Functions and API design](#10-functions-and-api-design)
11. [Type declarations and inference](#11-type-declarations-and-inference)
12. [Absence and optional values](#12-absence-and-optional-values)
13. [Assertions and narrowing](#13-assertions-and-narrowing)
14. [Finite values and state models](#14-finite-values-and-state-models)
15. [Zod and runtime boundaries](#15-zod-and-runtime-boundaries)
16. [Objects and collections](#16-objects-and-collections)
17. [Mutation and ownership](#17-mutation-and-ownership)
18. [Classes](#18-classes)
19. [Asynchronous code](#19-asynchronous-code)
20. [Errors and results](#20-errors-and-results)
21. [Comments and documentation](#21-comments-and-documentation)
22. [Tests and fixtures](#22-tests-and-fixtures)
23. [JSX and components](#23-jsx-and-components)
24. [Enforcement and exceptions](#24-enforcement-and-exceptions)
25. [Project configuration profiles](#25-project-configuration-profiles)
26. [Review checklist](#26-review-checklist)
27. [References](#27-references)

## 1 Rules and scope

### Rule language

**Must** and **must not** are requirements. **Prefer** establishes the default; depart from it only for a concrete improvement in clarity, correctness, or compatibility. **May** identifies an explicitly permitted choice. Imperative instructions are requirements.

Temelj records its runtime, module-resolution profile, tooling, and narrow integration conventions in the [project addendum](#temelj-project-addendum). The addendum fills in environmental choices; it must not silently weaken the core rules. Existing code or configuration that differs from this guide is not an implicit exception.

Examples illustrate the rule being discussed. Some omit surrounding declarations. Unless a different profile is named, relative code imports use Temelj's explicit `.ts` or `.tsx` source convention. Section 25 describes the build profile and other execution models.

### Core decisions

| Subject                          | Standard                                                                |
| -------------------------------- | ----------------------------------------------------------------------- |
| Source filenames and directories | `kebab-case`, including `.ts` and `.tsx`                                |
| Module system                    | ESM throughout handwritten project code                                 |
| TypeScript syntax                | `erasableSyntaxOnly: true`; no enums or namespaces                      |
| Type checking                    | Strict checking plus the additional checks in section 25                |
| Formatting                       | Two spaces, semicolons, double-quote preference, 100-column print width |
| Exports                          | Named exports; narrowly defined integration exceptions                  |
| Types                            | Type aliases by default; interfaces for intentional open contracts      |
| Functions                        | Declarations for named module behavior; arrows for callbacks            |
| Untrusted data                   | `unknown` at entry, Zod validation, typed parsed values inward          |
| Mutation                         | Owned and explicit; no surprising argument or shared-state mutation     |
| Promises                         | Await, return, or deliberately handle every promise                     |
| Automation                       | One formatter and a type-aware linter, checked in CI                    |

Generated and vendored files are exempt from formatting and naming rules. Keep them clearly identified, regenerate them from their source, and do not edit them to imitate handwritten style. Handwritten wrappers and integration code remain subject to this guide.

## 2 Required language baseline

### Use standard JavaScript with erasable types

Every TypeScript configuration that checks handwritten code must enable `strict` and `erasableSyntaxOnly`. Do not disable them for tests, scripts, or a difficult dependency.

Do not write:

- `enum` or `const enum` declarations.
- `namespace` declarations, including type-only namespaces.
- Legacy internal `module` declarations used as namespaces.
- Constructor parameter properties such as `constructor(private client: Client)`.
- TypeScript `import =` or `export =` assignments.
- Angle-bracket type assertions such as `<User>value`.
- Decorators or a dependency on TypeScript decorator metadata emit.

Use modules, ordinary objects, functions, explicit class fields, and types instead. The namespace and decorator prohibitions are style rules in addition to the compiler flag. The flag does not reject every type-only namespace or establish universal runtime compatibility. [2]

A declaration such as `declare module "external-package"` that accurately describes or augments an external module is distinct from an internal namespace. Keep necessary declaration work in focused `.d.ts` files; do not use ambient declarations to conceal missing runtime implementations. Do not add handwritten ambient enums or namespaces.

### Keep checking separate from execution

Transpilation, bundling, and type stripping are not substitutes for a full type check. Run a separate type-check command even if the development runner executes TypeScript successfully.

An erasable TypeScript file can still use JavaScript syntax or APIs that the chosen runtime does not support. JSX also needs its own compilation path. Node's built-in type stripping does not type-check code, ignores `tsconfig.json`, and does not execute `.tsx` files. [3]

Pin compiler and tool versions through the project's dependency and lockfile policy. Upgrade deliberately and resolve new diagnostics. Do not rely on an unpinned globally installed compiler.

## 3 Formatting and source text

### Let the formatter own layout

Use Oxfmt with the committed `.oxfmtrc.json` and `.editorconfig`. Run `pnpm format` to format and `pnpm format:check` to check formatting. Use one formatting engine for TypeScript. Oxlint owns correctness and semantic style without conflicting layout rules.

The required formatting policy is:

| Setting               | Value                                     |
| --------------------- | ----------------------------------------- |
| Encoding              | UTF-8                                     |
| Line endings          | LF                                        |
| Indentation           | Two spaces; no tabs                       |
| Statements            | Semicolons                                |
| Strings               | Double quotes by default                  |
| JSX attribute strings | Double quotes                             |
| Trailing commas       | Wherever the syntax and formatter permit  |
| Arrow parameters      | Parentheses, including a single parameter |
| Object braces         | Spaces inside nonempty braces             |
| Print width           | 100 columns                               |
| End of file           | One final newline                         |

Use the formatter's escape-minimizing quote choice when it selects another delimiter. A print width is a wrapping preference, not a demand to split URLs, regular expressions, or meaningful string literals. [4]

Do not manually align columns with spaces, wrap code to preserve a preferred visual shape, or add formatter ignores for ordinary code. A narrowly scoped ignore is acceptable for a literal whose layout itself conveys information, with a comment explaining why.

### Write clear source text

Keep one statement per line and one binding per declaration. Destructuring may introduce several related bindings in one declaration.

Use a single blank line to separate logical steps. Do not put blank lines immediately inside function or block braces. Do not use large decorative comment banners.

Use ordinary spaces for indentation and separation. Escape invisible or control characters in string literals and explain them when their purpose is not apparent. Readable Unicode is allowed in strings and comments; identifiers must use ordinary ASCII names unless an external interface requires otherwise.

Use template literals for interpolation or intentional multiline text. Use ordinary strings when neither is needed. Do not use line-continuation escapes to make a long string appear shorter in source.

## 4 Naming

Names must describe a value's domain meaning or an operation's effect. Avoid `data`, `item`, `thing`, `manager`, `helper`, and `handler` when a more specific term is available. A short name is acceptable inside an obvious, small scope; an abbreviation should not require a glossary.

### Casing

| Kind                                | Convention                     | Examples                             |
| ----------------------------------- | ------------------------------ | ------------------------------------ |
| Files and directories               | `kebab-case`                   | `read-config.ts`, `account-menu.tsx` |
| Variables, parameters, properties   | `camelCase`                    | `retryCount`, `accountId`            |
| Functions and methods               | `camelCase`                    | `loadAccount`, `parseOptions`        |
| Types, interfaces, classes          | `PascalCase`                   | `Account`, `JobStore`                |
| JSX components                      | `PascalCase`                   | `AccountMenu`                        |
| Type parameters                     | Descriptive `PascalCase`       | `Item`, `Key`, `Result`              |
| Fixed module-level data constants   | `CONSTANT_CASE`                | `MAX_RETRY_COUNT`, `DEFAULT_OPTIONS` |
| Zod schemas                         | `camelCase` ending in `Schema` | `accountSchema`                      |
| Services and constructed instances  | `camelCase`                    | `logger`, `accountStore`             |
| Enum-style value objects            | `PascalCase`                   | `JobStatus`                          |
| Members of enum-style value objects | `CONSTANT_CASE`                | `JobStatus.IN_PROGRESS`              |
| Error subclasses                    | `PascalCase` ending in `Error` | `ConfigurationError`                 |

Casing follows a binding's role, not merely the presence of `const`. Fixed module-level limits, lookup tables, regular expressions, and default data use `CONSTANT_CASE`. Functions, schemas, services, and framework builders do not become uppercase because they are assigned to `const`. Local constants use `camelCase`.

`CONSTANT_CASE` communicates intended stability; it does not freeze an object. Exported constant collections must also expose a readonly contract where practical.

### Meaning and consistency

- Treat acronyms as words: `userId`, `apiUrl`, `HttpClient`, `parseJson`.
- Use verbs for operations and nouns for values and types.
- Name booleans as predicates: `isReady`, `hasAccess`, `canRetry`, `shouldPersist`.
- Prefer positive booleans. Avoid names that produce double negatives at call sites.
- Use plural names for collections: `accounts`, `accountIds`.
- Include units when ambiguity is possible: `timeoutMs`, `sizeBytes`, `ratio`, `percentage`.
- Use `onSave` for a callback supplied by a caller and `handleSave` for an implementation that responds to that event, when that distinction applies.
- Do not add `Async` to every asynchronous function. Use it only to distinguish an intentional synchronous/asynchronous pair.
- Use a short generic name such as `T` only for a simple, conventional relationship. Prefer `Input` and `Output` when several type parameters participate.
- Do not prefix interfaces with `I`, types with `T`, or variables with their primitive type.
- Do not use leading or trailing underscores to indicate privacy. A required but unused positional parameter may use `_name`; remove unused parameters when the contract allows it.
- Preserve external field names in the external contract. Translate them once when constructing the internal model.

Do not rename imported symbols merely to apply a local naming preference. Alias them when resolving a collision or making an otherwise ambiguous external name clear.

## 5 Files and directories

### File names

Use `kebab-case` for all handwritten TypeScript and TSX filenames. A component named `AccountSettings` belongs in `account-settings.tsx`.

Use meaningful conventional suffixes when they add information:

| Purpose                          | Example                           |
| -------------------------------- | --------------------------------- |
| Implementation                   | `read-config.ts`                  |
| Unit test                        | `read-config.test.ts`             |
| Integration test                 | `read-config.integration.test.ts` |
| TSX test                         | `account-settings.test.tsx`       |
| Boundary schema                  | `job.schema.ts`                   |
| Ambient declarations             | `asset-types.d.ts`                |
| Platform-specific implementation | `file-store.node.ts`              |
| Tool configuration               | `vitest.config.ts`                |

The descriptive stem stays in kebab-case; dots separate recognized suffixes. Do not invent a new suffix vocabulary in each directory.

Use `.tsx` only for files containing JSX. Use `.ts` otherwise. Use `.mts` only where the toolchain needs an explicit ESM file marker. Do not introduce handwritten `.cts` or `.cjs` files.

A tool-required filename or route syntax is a narrow exception. Keep it within the integration that requires it; use normal names for the surrounding implementation.

### Group code by ownership

Group related code by capability or domain before grouping it by technical kind. A cohesive directory can contain implementation, schemas, types, tests, and private helpers.

Source packages live in `packages/<name>/src`. Keep capability-specific modules within their owning package. Add boundaries when there are distinct responsibilities or consumers; do not introduce application layers into a utility package without a reason.

The repository layout is:

| Path                               | Responsibility                                        |
| ---------------------------------- | ----------------------------------------------------- |
| `packages/<name>/src/mod.ts`       | Public package entry point                            |
| `packages/<name>/src/**/*.test.ts` | Colocated behavior and type-contract tests            |
| `packages/<name>/README.md`        | Package usage and public API examples                 |
| `packages/<name>/package.json`     | npm exports, dependencies, and commands               |
| `packages/<name>/deno.json`        | JSR/Deno source exports and publish rules             |
| `lib/src/<name>/mod.ts`            | Selected foundational re-exports for `@tinrab/temelj` |
| `examples/**`                      | Applications demonstrating package integrations       |
| `scripts/`                         | Shared tooling and compiler configuration             |

Keep a helper near its first owner. Move it to a shared module only after its responsibility and consumers are clear. Do not create large catch-all files named `utils.ts`, `helpers.ts`, `common.ts`, or root-level `types.ts`. A focused `types.ts` within a small, cohesive API is acceptable.

### Keep modules cohesive

A file should have one primary responsibility and a small public API. It may contain several tightly related exports. Do not impose one export per file or split every type and helper into its own module.

Keep a type or schema with the behavior that owns it unless independent consumers need a separate dependency. Split when unrelated responsibilities, environment requirements, or dependency cycles make the boundary useful.

Keep entry points thin: read inputs, compose dependencies, invoke behavior, and translate outputs. Substantial domain logic belongs in ordinary modules that can be called without starting the application.

Colocate unit tests with their source. Keep cross-cutting integration or end-to-end tests in a dedicated test area when they span several modules. Store small fixtures near the tests that own them.

### Order code for reading

Keep this broad order within a source file:

1. A required executable shebang, then any license or short file-level explanation.
2. Required directive prologues, such as a framework directive, before imports.
3. Imports, with any evaluation-sensitive setup order preserved.
4. Fixed data, schemas, and supporting types needed to understand the module's API.
5. Exported behavior and the private helpers that explain its implementation.

Keep related declarations together. A schema-inferred type belongs beside its schema. A private helper may follow the exported function that calls it; function declarations allow this reading order. Do not read a `const`, `let`, or class binding before it is initialized.

Do not alphabetize implementation declarations or collect every unrelated type at the top merely for symmetry. Preserve dependency order for values evaluated during module initialization.

## 6 Modules and dependencies

### Use ESM consistently

Use `import` and `export` in all handwritten source and tooling code. Do not use `require`, `module.exports`, `exports`, `import =`, or `export =`.

Set `"type": "module"` in each package whose JavaScript is intended to be ESM. Align compiler output, package metadata, test runners, and production execution. ESM-looking source alone does not establish the runtime's module format. [5]

A dependency may internally use CommonJS if the selected runtime supports consuming it through ESM. Verify that integration. Do not spread compatibility code across the project or change project source to CommonJS to accommodate one dependency.

### Make dependency direction visible

Lower-level data models and domain behavior must not import entry points, route files, view composition, or platform startup code. Introduce a small explicit contract when core behavior needs an external capability.

Import another package through its declared entry point or public subpath. Do not reach into its private source tree. Declare a dependency in the package that imports it, including type-only dependencies where the packaging contract requires them. Prefer existing package utilities before adding a dependency. Use `workspace:*` for internal package dependencies. Keep workspace import mappings in `deno.json` aligned with those dependencies.

Do not create circular dependencies, including cycles introduced by re-exports. Move the shared contract to the appropriate owner instead of hiding a cycle behind dynamic imports.

Use `mod.ts` for an intentional package or feature API; do not introduce `index.ts` barrels. Do not create barrels in every directory. Code inside a package must not import its own public barrel to reach a sibling module.

### Limit module initialization

Reusable modules must not open network connections, start timers, read process-specific configuration, launch tasks, or register global behavior merely because they are imported.

Prefer exported initialization functions and factories. Construct pure schemas and fixed data at module scope. Keep runtime configuration reads and lifecycle ownership at the composition boundary.

Use explicit, reviewed side-effect imports only for integrations that require them, such as a polyfill or stylesheet. Preserve their evaluation order. File suffixes such as `.server.ts` are documentation unless actual tooling enforces the boundary; use real module restrictions for incompatible environments.

## 7 Imports and exports

### Import syntax and ordering

Prefer named imports. A namespace import such as `import * as path from "node:path"` is allowed for an API that is clearer as a coherent namespace. It is an ESM import, not a TypeScript namespace declaration.

Use a whole `import type` declaration when every imported binding is used only as a type. Use `export type` for type re-exports. When a module supplies both values and types, use separate declarations and keep them adjacent.

```ts
import { readFile } from "node:fs/promises";
import { z } from "zod";

import type { Job, JobId } from "./job.ts";

import { createJob } from "./job.ts";

export type { JobId } from "./job.ts";
```

Under `verbatimModuleSyntax`, a whole `import type` is erased. A declaration containing only inline `type` specifiers can leave an empty runtime import, so do not use that form for an entirely type-only dependency. [6]

Group ordinary imports in this order: runtime built-ins, third-party packages, workspace packages and project aliases, relative modules. Separate nonempty groups with one blank line. Use checked-in tooling to sort module specifiers and named bindings; do not maintain the order by hand.

Do not let sorting change evaluation-sensitive import order. Put required side-effect setup in a clearly identified block and configure the sorter to preserve it. Prefer explicit initialization over relying on incidental ordering among ordinary value imports.

Use `node:` for Node built-ins. Use the package's public specifier for packages; do not append extensions to bare package names.

### Paths and extensions

Use relative imports for nearby code within the same package. Use package entry points across packages.

Use an alias only when the checker, runtime, bundler, and tests all resolve it consistently. TypeScript's `paths` does not rewrite emitted imports. Prefer a supported package import/export mapping to an alias understood only by the editor. [24]

Choose exactly one relative code-import convention for each compilation unit:

- **Emitted JavaScript:** write the emitted extension, usually `./read-config.js`.
- **Bundled source:** write explicit source extensions, such as `./read-config.ts` or `./account-menu.tsx`, with the configuration in section 25.
- **Direct TypeScript execution:** write the actual source extension, such as `./read-config.ts`.

Do not use implicit directory imports. Write `./jobs/mod.ts` for an intentional source entry point, or its emitted equivalent for a different profile. Node ESM requires explicit relative extensions and explicit directory indexes. [5]

A framework-generated import convention may be documented as an integration exception. Do not switch resolver modes merely to make a broken runtime import type-check.

### Import JSON with attributes

Use modern import attributes for JSON module imports:

```ts
import type { Defaults } from "./defaults.schema.ts";

import defaultsJson from "./defaults.json" with { type: "json" };
import { defaultsSchema } from "./defaults.schema.ts";

export const DEFAULTS: Readonly<Defaults> = defaultsSchema.parse(defaultsJson);
```

For a genuinely lazy JSON module:

```ts
export async function loadDefaults(): Promise<unknown> {
  const { default: defaultsJson } = await import("./defaults.json", {
    with: { type: "json" },
  });

  return defaultsJson;
}
```

Require `with { type: "json" }` on static JSON imports and `{ with: { type: "json" } }` on dynamic JSON imports. Do not use the legacy `assert` syntax. JSON uses a default export, so its default import is allowed. [5]

Enable `resolveJsonModule` in compilation units that import JSON. This provides static resolution and shape information; it does not validate application constraints or implement runtime loading. [23] Validate configuration and other boundary data with Zod.

Import attributes describe a module's interpretation. They do not make arbitrary file types importable. Other assets require a documented convention supported by the actual runtime or bundler. Do not add attributes to ordinary TypeScript or JavaScript imports.

Use static imports for fixed module assets. Read user-selected, mutable, or runtime-discovered files with the platform's I/O API, then parse and validate them. Module imports are not a replacement for file I/O.

### Export deliberately

Use named exports for first-party APIs. Export declarations where they are defined.

A default export is allowed only when a framework, tool, or external format requires that shape. Give the declaration a meaningful name when possible. A dependency's required default import is also allowed. Temelj examples include tool configuration files and `packages/mdx/src/loader.ts`, where loader-runner requires a default callable. Keep that loader implementation available as a named export too.

Export only what another module needs. Do not export private helpers solely to test them.

Do not use `export *` in handwritten public APIs. List re-exports explicitly in `src/mod.ts` so API growth is visible in review. Do not export mutable bindings such as `export let`. Encapsulate changing state behind a function or an owned object API.

Treat every export as maintained API. Keep normalization helpers, mutable state, adapters, decoder details, and internal context types private. Align `package.json`, `deno.json`, build entries, and source barrels. Each public subpath has one source entry and one declared export.

The aggregate package in `lib/` re-exports only the selected foundational packages that belong in `@tinrab/temelj`. Optional, specialized, or environment-specific packages may remain direct `@temelj/<name>` imports.

## 8 Variables and expressions

### Bind values deliberately

Use `const` by default. Use `let` only when reassignment is part of the algorithm. Never use `var`.

Declare a binding close to its first use. Do not declare a variable uninitialized and then assign it far away when an expression or helper can produce its value directly.

Do not reuse one variable for different concepts. Avoid shadowing an outer binding when it obscures which value a reader is using.

Destructure when it makes a small set of properties clearer. Keep parameter destructuring shallow. Do not destructure a long path merely to save a few characters.

### Prefer direct expressions

Use `===` and `!==`. Do not use coercive equality, including `value == null`; write the intended nullish check explicitly.

Use `??` when only `null` and `undefined` should trigger a fallback. Use `||` only when every falsy value should trigger it.

```ts
type RetryOptions = {
  retryCount?: number;
};

export function getRetryCount(options: RetryOptions): number {
  return options.retryCount ?? 3;
}
```

Here, `0` remains a meaningful value.

Use optional chaining only when absence is valid. Do not use `?.` to silently skip behavior that the program requires.

Use explicit conversion functions such as `Number(value)` and `String(value)` when conversion is intended. Avoid unary-plus coercion, `~~value`, implicit string concatenation for conversion, and `!!value`; use `Boolean(value)` when truthiness conversion is the actual operation.

Do not confuse conversion with validation. For example, numeric conversion needs a policy for blank strings, non-finite numbers, and accepted syntax.

Use parentheses when mixed operators would otherwise require readers to recall precedence. Do not use assignments inside conditions, comma operators, nested ternaries, or logical operators solely to perform side effects.

Do not use `eval`, the `Function` constructor, or strings as timer callbacks. Do not modify built-in constructors or prototypes. Do not commit `debugger` statements.

## 9 Control flow

### Make branches explicit

Always use braces for `if`, `else`, `for`, `for...of`, `while`, and `do` bodies.

```ts
if (!isReady) {
  return;
}

startJob();
```

Prefer guard clauses when they reduce nesting. Do not add `else` after an unconditional `return` or `throw` unless the paired structure makes a larger algorithm clearer.

Use a ternary only for one small choice of value. Never nest ternaries. Use named intermediate values or `if` statements for more involved decisions.

Boolean values may be tested directly. For numbers, strings, and nullable primitives, test the intended condition explicitly: `count > 0`, `name.length > 0`, or `value !== undefined`. An optional object may use a presence check when no other falsy value is possible.

Avoid large compound conditions. Give an independently meaningful condition a name or extract a predicate.

### Switches

Use `switch` for a finite set of alternatives when it makes the cases easier to scan. Do not fall through between executable cases. Multiple empty labels sharing a body are allowed.

Use braces around a case that declares a lexical binding. Return from cases when the switch computes the function's result.

For a closed union, require exhaustiveness with `never` as shown in section 14. For open external values, validate first or provide meaningful unknown-value handling. Do not add an empty `default` merely to satisfy a stylistic convention.

### Loops

Prefer `for...of` for iteration and `for await...of` for asynchronous iterables. Use an indexed loop when the index or traversal strategy is part of the algorithm.

Use `continue` to skip work and `break` to finish a loop when those statements make the control flow clear. Do not force nested conditionals to avoid them.

Do not use `for...in`. Use `Object.keys`, `Object.values`, or `Object.entries` for object data.

## 10 Functions and API design

### Function form

Use named function declarations for reusable module-level behavior.

```ts
export function normalizeLabel(label: string): string {
  return label.trim();
}
```

Use arrow functions for callbacks, closures, and values that must conform to a function type. A framework's inference-preserving function builder may also produce an exported binding.

```ts
const accountIds = accounts.map((account) => account.id);

accounts.forEach((account) => {
  cacheAccount(account);
});
```

Use a concise arrow body for a single returned expression. Use a block body for side effects, even when the current callee returns `void`. This prevents a later return-value change from silently altering callback behavior.

Do not use function expressions solely to avoid a declaration. Use them when dynamic `this` or an external API specifically requires that behavior.

### Parameters and returns

Give public option objects named type aliases or intentional open interfaces. Require explicit parameter and return types for ordinary exported functions and public methods. A return type prevents an implementation change from silently changing the public contract.

Private helpers and contextually typed callbacks may infer their returns. Schema definitions, inference-oriented builders, and framework callbacks may retain inferred public types when writing an annotation would discard useful type information. Do not replace precise inference with a broad annotation merely to satisfy a lint rule.

Prefer an options object when there are more than two independent inputs, several inputs of the same primitive type, or an argument whose meaning is unclear at the call site. A natural pair such as a key and value may remain positional.

```ts
type RetryPolicy = {
  readonly maxRetries: number;
  readonly delayMs: number;
};

export function calculateRetryDelayMs(retryIndex: number, policy: RetryPolicy): number | undefined {
  if (retryIndex >= policy.maxRetries) {
    return undefined;
  }

  return policy.delayMs * 2 ** retryIndex;
}
```

Do not use unexplained boolean arguments such as `saveRecord(record, true, false)`. Use named options or separate operations.

Put required parameters before optional parameters. Use defaults at the point that owns the policy. Defaults apply to missing or `undefined` arguments, so do not use them when explicit `undefined` has a distinct meaning.

Avoid output parameters. Return a named object for several related results. Use tuples only for a small positional convention that callers already understand.

Do not use sentinel values such as `-1` or `""` for a domain failure when a union or explicit absence is clearer. Preserve sentinel conventions of standard APIs at their boundary.

### Responsibility and dependencies

Keep a function focused on one operation at a consistent level of abstraction. Extract a block when it has an independently useful name, hides a distracting detail, or needs a different dependency.

Do not extract every few lines mechanically. Avoid arbitrary function-length limits that reward fragmentation.

Pass dependencies to reusable behavior when they affect execution: clocks, random generators, stores, network clients, and output sinks. Do not make reusable functions read ambient process state or reach into a global service registry.

Prefer composition and ordinary parameters to a generic framework invented for a single call site.

### Keep abstractions useful

Prefer direct code until an abstraction removes real duplication, names a domain concept, or protects a non-obvious invariant. Do not add pass-through helpers that only forward calls, rename an existing predicate, or wrap a single check. Use the existing operation directly unless the helper has a stable domain meaning used in several places.

Do not wrap object construction, property access, `Object.freeze`, or error forwarding without adding a domain invariant. Avoid layers named "manager", "service", "engine", "api", "impl", or "utils" that only move code around. A layer must own state, isolate an external dependency, or define a real boundary.

Share the semantic core of an algorithm across backends or synchronous and asynchronous variants. Isolate the actual boundary differences instead of maintaining parallel copies.

Before retaining an abstraction, find its callers. Delete unused code, exports, and state. Delete helpers whose only purpose was an earlier refactor when their bodies are obvious at every call site.

### Change APIs directly

Temelj does not require backwards compatibility for new versions. Prefer the cleanest current design. Do not retain old overloads, duck-typed inputs, aliases, forwarding wrappers, migration shims, or version-bridging code unless explicitly requested.

Migrate all workspace callers in the same change, then delete the replaced API. Update tests, README examples, exports, and dependent packages directly.

## 11 Type declarations and inference

### Use type aliases by default

Use `type` for application data, unions, tuples, function contracts, derived types, and schema-inferred types.

```ts
export type AccountSummary = {
  readonly id: string;
  readonly displayName: string;
};

export type LoadAccount = (id: string) => Promise<AccountSummary>;
```

Use `interface` when an API intentionally supports extension or declaration merging, or an external integration requires it. Do not use merging to invisibly add fields to ordinary domain models.

This is a consistency policy. Both aliases and interfaces participate in structural typing; a type alias does not create an exact or sealed object shape. [8]

Prefer a direct named shape over deep intersections. Where an intentional open hierarchy is substantial, interface extension is clearer than stacking intersection aliases.

### Use inference where it helps

Infer obvious local values. Do not write `const retryCount: number = 3`.

Annotate a local variable when it intentionally has a wider type than its initial value, when a collection starts empty and needs an element type, or when the type explains an otherwise unclear contract.

Use `satisfies` for authored literals that must meet a contract while preserving useful specificity. Use a type annotation when the binding should present the broader contract.

```ts
type OutputFormat = "json" | "text";

export const MIME_TYPES = {
  json: "application/json",
  text: "text/plain",
} as const satisfies Record<OutputFormat, string>;
```

`satisfies` checks static compatibility; it does not validate runtime data. Contextual typing can still affect inference. Do not treat it as a runtime check or an exact-object mechanism. [9]

### Use precise basic types

Use `string`, `number`, `boolean`, `bigint`, and `symbol`. Do not use wrapper types such as `String`, `Number`, or `Boolean`.

Use `unknown` when a value is unspecified or untrusted. Use `object` only when the contract truly means any non-primitive value. Use `Record<string, unknown>` only when the contract truly describes a string-keyed record.

Do not use `any`, `Object`, `Function`, or `{}` as placeholder types. Write the shape or function signature that the operation needs. In particular, `{}` is not an empty-object contract. [8]

Do not let a third-party `any` propagate. Assign it to `unknown` at the adapter boundary, then validate or narrow it.

Use `void` for a return value callers must ignore, `never` for a path that cannot return, and `undefined` when absence is a value in the contract.

### Collections and generic types

Use `T[]` and `readonly T[]` for arrays. Parenthesize union elements: `(string | number)[]`. Introduce a named element type when the expression becomes hard to read.

Use labelled readonly tuples for small fixed positional structures, such as `readonly [width: number, height: number]`. Prefer an object when positions need repeated explanation.

Use generics to preserve meaningful type relationships. In a function signature, do not add a type parameter when a concrete type or `unknown` expresses the same contract. Do not add a generic solely to let the caller assert a return type or to make a fixed domain model look configurable. Generic data containers may use their parameter in a single field. Preserve literal inference with `const` type parameters in public builders and schema helpers where it materially improves caller types.

Prefer a union parameter to overloads when the return type does not depend on the input alternative. Keep required overloads adjacent and maintain one clear implementation.

Use built-in utility types when they clarify intent. Do not expose a large nested conditional or mapped type merely to avoid a small explicit declaration. Name and test reusable type-level operations.

## 12 Absence and optional values

Use `undefined` for optional application values. Preserve `null` when it carries an intentional meaning in a protocol, database, or domain.

Do not make every type globally nullable. Add absence at the particular boundary where it occurs.

Under `exactOptionalPropertyTypes`, these are different contracts:

| Declaration                   | Meaning                                                   |
| ----------------------------- | --------------------------------------------------------- |
| `label?: string`              | Property may be omitted; a present value must be a string |
| `label: string \| undefined`  | Property must be present; its value may be undefined      |
| `label?: string \| undefined` | Omission and explicit undefined are both permitted        |
| `label: string \| null`       | Property is required; null is an intentional value        |

These distinctions concern optional properties. An optional function parameter still accepts an explicit `undefined` argument. Reading an optional property can also produce `undefined`. [10]

Omit an optional property when it is absent instead of constructing `{ label: undefined }` for a `label?: string` contract.

```ts
type DisplayOptions = {
  readonly label?: string;
};

export function makeDisplayOptions(label: string | undefined): DisplayOptions {
  if (label === undefined) {
    return {};
  }

  return { label };
}
```

Treat omission, clearing a value, and supplying a value as separate operations when the domain needs them. For an update command, `undefined` may mean “leave unchanged” while `null` means “clear”; make that contract explicit.

Do not use optional fields to represent mutually exclusive states. Use a discriminated union.

## 13 Assertions and narrowing

### Narrow before use

Prefer checks that the compiler understands: `typeof`, `instanceof`, discriminant comparisons, presence checks, and control flow.

Validate external data with a schema. An assertion cannot establish that a response, parsed JSON value, DOM lookup, or environment variable has the required shape.

Do not write:

- Double assertions such as `value as unknown as Account`.
- `as any`.
- Non-null assertions such as `account!` or `accounts[0]!`.
- Definite-assignment assertions such as `client!: Client`.
- Type assertions that force a mismatched object literal into a desired type.

Use a checked invariant instead:

```ts
export function requireValue<Value>(value: Value | null | undefined, message: string): Value {
  if (value === null || value === undefined) {
    throw new Error(message);
  }

  return value;
}
```

Do not use bracket access or a cast to bypass class visibility. Move the operation to the owning class or expose an intentional capability.

### Keep escape hatches narrow

`as const` is allowed to preserve literal values and readonly literal structure.

A single `as SomeType` assertion is allowed only when a documented invariant or an external declaration limitation establishes the relationship and TypeScript cannot express it. Keep it at the smallest adapter boundary, explain the invariant, and cover the behavior that justifies it. “The compiler complains” is not a reason.

Do not move an unsafe assertion into a helper and call it a type guard. Explicit predicates such as `value is Account` are trusted by the compiler; the compiler does not verify that the implementation proves the claim. [11]

Prefer inferred predicates for simple filtering:

```ts
const presentLabels = labels.filter((label) => label !== undefined);
```

Do not use `filter(Boolean)` to remove only missing values: it also removes valid falsy values. A custom predicate or assertion function must establish every property it promises and have tests for rejection as well as success.

Do not use `@ts-ignore` or `@ts-nocheck`. Temporary `@ts-expect-error` use is governed by section 24; negative type tests have their own rule in section 22.

## 14 Finite values and state models

### Replace enums with ordinary values

For a finite vocabulary needed only by the type checker, use a literal union:

```ts
export type SortDirection = "ascending" | "descending";
```

For values accepted from outside the program, use a Zod enum schema and infer the type. If callers need meaningful named runtime members, use this pattern:

```ts
import { z } from "zod";

export const JobStatus = {
  QUEUED: "queued",
  IN_PROGRESS: "in-progress",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
} as const;

export const jobStatusSchema = z.enum(JobStatus);

export type JobStatus = z.infer<typeof jobStatusSchema>;
```

Zod 4 accepts an enum-like object in `z.enum`. Do not use the older `z.nativeEnum` API in new code. [12]

The object and inferred type deliberately share a PascalCase name. Schema names remain camelCase. Runtime member keys use `CONSTANT_CASE`; serialized values use the exact spelling the contract requires.

Use `JobStatus.QUEUED` where named runtime members have been defined. Do not repeat their serialized string literals throughout the implementation. Do not duplicate the vocabulary in a handwritten union.

For a small boundary vocabulary without useful named members, define `z.enum(["json", "text"])` directly. Use a `CONSTANT_CASE` readonly tuple only when other runtime code also needs that collection.

### Model valid states directly

Use a discriminated union when a value can be in one of several states. Keep each state's required data in that variant. Do not recreate a closed union with constructor arrays or repeated `instanceof` checks.

```ts
export type LoadState<Value> =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "loaded"; readonly value: Value }
  | { readonly kind: "failed"; readonly error: Error };

export function describeLoadState(state: LoadState<unknown>): string {
  switch (state.kind) {
    case "idle":
      return "Not started";
    case "loading":
      return "Loading";
    case "loaded":
      return "Loaded";
    case "failed":
      return state.error.message;
    default:
      return assertNever(state);
  }
}

function assertNever(_value: never): never {
  throw new Error("Unhandled load state");
}
```

The `never` parameter makes a newly added variant fail type checking at the unhandled switch. The helper also throws if an invalid value reaches it at runtime. [13]

Do not replace this check with a generic fallback that quietly accepts a new state. Avoid state objects with several booleans and unrelated optional fields when they permit impossible combinations.

For a fixed mapping rather than branching behavior, prefer a complete `Record<Variant, Value>` checked with `satisfies`.

## 15 Zod and runtime boundaries

### Validate where trust changes

Use Zod for runtime validation of structured external data: configuration, environment variables, command-line arguments, URLs, forms, network payloads, persisted data, messages, and third-party responses.

Treat raw values as `unknown` even when a permissive API returns `any` or lets the caller supply an unchecked generic type.

Define each boundary contract once. Infer its TypeScript type from the schema. Do not maintain a parallel handwritten interface for the same validated shape.

```ts
import { z } from "zod";

export const createJobSchema = z.strictObject({
  label: z.string().trim().min(1).max(120),
  retryCount: z.number().int().min(0).max(10).default(3),
});

export type CreateJob = z.infer<typeof createJobSchema>;

export function parseCreateJob(input: unknown): CreateJob {
  return createJobSchema.parse(input);
}
```

Continue with the value returned by `parse` or `result.data` from `safeParse`. Do not validate and then return the original input: parsing may normalize values, apply defaults, or remove properties. [14]

Parse at the boundary and pass typed values inward. Do not repeat the same validation in every internal helper. Validate again when crossing a new trust boundary or when external state can invalidate the previous guarantee.

A schema establishes the constraints it checks. It does not establish authorization, resource ownership, or every domain invariant.

TypeScript is the source of truth for already typed internal options. Do not schema-check them merely to recover a guarantee their types already provide.

For public APIs that accept caller-provided validators, keep interoperability through `@temelj/standard-schema`. Keep the accepted schema's input/output relationship intact instead of requiring callers to use a particular validator library.

### Name parsing operations precisely

Reserve `parse*` for functions that parse unknown, string, serialized, or external input and can reject malformed data. Use `resolve*`, `normalize*`, or direct code for typed option normalization.

Inline one-off invariant checks and throw a named error. Keep `assert*`, `validate*`, and `require*` helpers only when they encode a reusable invariant or clarify a larger algorithm.

At an unknown-object boundary, use established predicates from `@temelj/value`, then validate the required fields. Do not add a local generic `isRecord` helper. Prefer existing structured helpers such as `deepEquals` over local field-by-field equality implementations.

Parser grammar code uses character literals such as `"*"` and `"\\"`, named boundary constants, and semantic predicates. Do not use anonymous numeric character codes in grammar logic.

### Choose object strictness intentionally

Use the following policy:

| Boundary                                                               | Default                                      |
| ---------------------------------------------------------------------- | -------------------------------------------- |
| Commands and configuration whose field set the project owns            | `z.strictObject`                             |
| External responses where additional fields are expected to be harmless | `z.object`                                   |
| A contract that intentionally preserves extension fields               | Explicit `z.looseObject` or `.catchall(...)` |

Strict objects reject unknown properties; ordinary objects strip them from the parsed result. Preserving extra properties must be an intentional part of the contract. [12]

An API that explicitly promises additive compatibility may choose a different input policy. Record that decision with the schema rather than depending on a constructor chosen accidentally.

### Keep input and output distinct

Use `z.infer` for the parsed output type. Use `z.input` when a trusted caller genuinely needs the pre-parse type, and `z.output` when naming the distinction makes a transform clearer. An untrusted boundary still accepts `unknown`. [14]

```ts
import { z } from "zod";

export const retryCountTextSchema = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(0).max(10));

export type RetryCountText = z.input<typeof retryCountTextSchema>;
export type RetryCount = z.output<typeof retryCountTextSchema>;
```

Do not annotate a concrete schema with a broad schema base type if doing so loses its shape or input/output inference.

`.optional()` permits `undefined`; it does not automatically mean an exact optional property that rejects a present `undefined`. Keep the inferred contract honest and normalize omissions when a stricter internal model needs them. [15]

### Parse and report failures deliberately

Use `parse` when validation failure belongs on an exception path, such as invalid startup configuration. Use `safeParse` when validation failure is an expected branch to display or return.

Use `parseAsync` or `safeParseAsync` for schemas with asynchronous refinements or transforms. Handle the resulting promise. [14]

Keep refinements and transforms small and focused. Report validation failures through Zod's supported mechanism; do not throw arbitrary exceptions inside them. `safeParse` is not a catch-all for programmer errors thrown by custom schema code. [15]

Translate validation failures into the boundary's documented error shape. Do not expose raw input values, internal paths, or entire error objects without considering the consumer.

### Coerce only at an intentional conversion boundary

Do not use coercion to accept malformed data silently. Validate the representation before converting when the allowed syntax matters.

For boolean text, use an explicit vocabulary:

```ts
import { z } from "zod";

export const booleanTextSchema = z.enum(["true", "false"]).transform((value) => value === "true");
```

Do not use `z.coerce.boolean()` for this contract: it follows JavaScript truthiness, so the string `"false"` becomes `true`. [16]

A default should handle intentional absence. Do not use `.catch(defaultValue)` to conceal invalid required configuration.

Keep environment access in an adapter. Under the required index-signature rule, use `process.env["PORT"]` rather than `process.env.PORT`, then validate and pass a typed configuration object inward.

### Serialize deliberately

Define transport representations for dates, timestamps, durations, `bigint` values, maps, sets, and other values without a single obvious JSON representation.

Use explicit units and document timezone semantics. A project may choose Unix milliseconds or an ISO timestamp for an instant; do not silently mix them. A calendar date is not interchangeable with an instant.

Do not assume `undefined`, prototypes, methods, or class identity survive serialization. Construct intentional boundary objects and avoid spreading internal records directly into public responses.

## 16 Objects and collections

### Choose the appropriate structure

Use object and array literals. Do not use `new Object`, `Object()`, `new Array`, or `Array()` to construct ordinary data. Use `Array.from` when creating a collection from a length or iterable.

Never instantiate primitive wrapper objects such as `new String` or `new Boolean`.

Use:

- An object for a known record shape.
- `Record<Key, Value>` for a fixed key vocabulary.
- A partial record or checked lookup for keys that may be absent.
- `Map` for a dynamic key collection, especially with non-string keys.
- `Set` for membership or uniqueness.
- An array for ordered values.

Do not add named properties to arrays. Do not use an object literal as an unbounded dictionary when a `Map` would express the operation more clearly.

A `Record<string, Value>` is not a runtime guarantee that every key exists. Check arbitrary lookups; `noUncheckedIndexedAccess` makes missing indexed values visible in many such cases. [17]

### Use collection methods for their purpose

Use `map` to transform, `filter` to select, `find` to locate, and `some` or `every` for predicates. Do not use `map` solely for side effects.

Use `reduce` when an accumulation is easier to understand as a reduction. Prefer a clear loop over a reducer that mutates several unrelated fields or repeatedly copies a growing collection.

Use `Object.hasOwn` when checking whether an object itself owns a property. Do not call an input object's potentially shadowed `hasOwnProperty` method.

When a collection is searched repeatedly inside a loop, build an index with the correct lifetime instead of rescanning it. Keep readable one-off searches direct.

Do not sort or reverse an input array in place. Use a supported nonmutating method or copy it first. Supply a comparator for numeric and domain-specific sorting; state any locale-sensitive sorting policy.

```ts
export function sortScores(scores: readonly number[]): number[] {
  return [...scores].sort((left, right) => left - right);
}
```

### Spread and destructure carefully

Spread iterables into arrays and plain record-like objects into objects. Do not spread class instances, maps, sets, or arbitrary primitives into an object literal to “copy” them.

Use an explicit empty object or array in a conditional spread:

```ts
const headers = {
  ...baseHeaders,
  ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
};
```

Do not conditionally spread `false`, `null`, or `undefined`. Remember that object spread is shallow and later properties replace earlier ones. Make override order intentional, especially when one source is external input.

Avoid a conditional empty-object spread solely to omit an optional value. Assign `undefined` directly when the type permits it and property presence has no meaning. Otherwise, omit the property as section 12 requires, using explicit construction when needed. The spread example shows valid operand syntax; Temelj's current lint restriction is recorded in section 25.

## 17 Mutation and ownership

Prefer pure functions for calculations, transformations, validation, and domain rules.

Use readonly properties, `readonly T[]`, `ReadonlyMap`, and `ReadonlySet` in contracts that do not permit mutation. Apply these modifiers where they protect a meaningful boundary rather than adding them mechanically to every local binding.

Do not mutate arguments or caller-owned collections unless mutation is the function's explicit purpose. Name mutating operations clearly and document what they change.

Local mutation is allowed for a newly owned accumulator, a loop variable, or a stateful object's private implementation. Do not replace a simple owned loop with repeated object spreading purely to avoid mutation syntax.

`const` prevents rebinding. `readonly` and `as const` constrain TypeScript code but do not freeze data at runtime. Mutable aliases may still exist. [18] If runtime immutability is required, implement and document it explicitly.

Do not export a mutable collection for callers to alter directly. Return snapshots, expose a readonly view with a clear ownership contract, or provide explicit operations.

Avoid duplicated state that can be derived cheaply from authoritative values. If a cache or snapshot is necessary, define who updates it and when it becomes invalid.

Give each concept one canonical representation. Add input, resolved, or internal forms only when each has a distinct invariant. Translate external representations once and use the canonical internal representation afterward.

Values carry the semantic data described by their types. Do not hide required meaning in module-level `WeakMap` or `WeakSet` registries, out-of-band brands, CSS classes, or getters that recover a second representation. Weak collections may hold ephemeral identity metadata such as cycle detection or provenance.

Carry domain intent explicitly instead of recovering it from presentation markup, class names, or constructor identity. Keep representations separate when their trust, lifecycle, or execution semantics differ. Share their common operations, not their identities.

Freeze values only when observable immutability is part of the public contract or the same value crosses ownership boundaries. TypeScript `readonly` is enough for private implementation values.

## 18 Classes

Use a class when identity, lifecycle, encapsulated state, or a platform contract benefits from it. Use plain objects and functions for ordinary data and stateless operations.

Do not create a class containing only static members for namespacing. Use a module.

For a stateful runtime implementation of a public contract, prefer an ordinary class such as `export class FooImpl implements Foo`, with methods and readonly properties. Avoid object-literal `api` shells and empty `interface FooImpl extends Foo {}` declarations.

### Fields and construction

Declare fields explicitly. Initialize them at declaration or in the constructor. Do not use parameter properties or definite-assignment assertions.

Use JavaScript `#private` fields and methods for implementation privacy. Use `protected` only for an intentional subclass contract; omit redundant `public` modifiers.

```ts
export class AttemptCounter {
  #attempts = 0;
  readonly #limit: number;

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError("Attempt limit must be a positive integer");
    }

    this.#limit = limit;
  }

  tryAdvance(): boolean {
    if (this.#attempts >= this.#limit) {
      return false;
    }

    this.#attempts += 1;
    return true;
  }
}
```

Keep constructors synchronous and focused on establishing a valid object. Do not start asynchronous work or perform hidden network I/O from a constructor. Use an explicit asynchronous factory or initialization operation when needed.

### Methods and inheritance

Use ordinary method syntax. Use an arrow field only when a callback needs a stable lexical `this`; do not make every method an arrow by default.

Do not pass an unbound method as a callback when it depends on `this`. Wrap the call or bind it deliberately.

Prefer composition. Use inheritance only for a real substitution contract, and mark overriding members with `override`.

Use getters for cheap, unsurprising property-like reads. Do not hide I/O or substantial work behind property access. Prefer an explicit mutating method to a setter that initiates unrelated behavior.

Avoid public writable fields. Expose the smallest state and behavior contract the caller needs.

## 19 Asynchronous code

### Make promise ownership explicit

Prefer `async`/`await` for sequential workflows. Promise combinators and short chains are allowed when they express concurrency or a simple transformation more clearly.

Every promise must be awaited, returned to a caller that owns it, or deliberately detached with a rejection handler. `void` alone does not handle rejection. [19]

```ts
void refreshCache().catch((error: unknown) => {
  reportBackgroundFailure(error);
});
```

In this pattern, `reportBackgroundFailure` must be synchronous and nonthrowing. If reporting can fail, handle that failure too.

Use detached work only when the surrounding lifecycle permits it to finish and losing the work is acceptable. A request handler or short-lived process must not assume a background promise will complete after its owner exits. Use a durable job mechanism when completion matters.

Do not pass an `async` callback to an API that ignores its returned promise. In particular, do not use `forEach(async ...)`. Use an awaited loop or an explicitly awaited concurrency operation.

When an API permits both synchronous and asynchronous completion, preserve synchronous completion when a dependency returns a value. Do not add `async` solely to normalize both paths.

### Choose concurrency deliberately

Run independent bounded operations together:

```ts
const [account, permissions] = await Promise.all([
  loadAccount(accountId),
  loadPermissions(accountId),
]);
```

Await dependent operations in order. Do not start a request before its prerequisites or access checks have completed.

Use bounded concurrency for potentially large collections. An unbounded `Promise.all(values.map(...))` can start every operation at once.

`Promise.all` does not cancel the remaining operations when one fails. Use cancellation or cleanup where required. Use `Promise.allSettled` only when every outcome is needed, and inspect every result.

### Preserve errors and lifecycle

Use `return await` inside a `try` block when the surrounding `catch` must handle the promise's rejection, or when `finally` must wait for the operation before releasing its resources. A bare returned promise bypasses that catch for a later rejection and allows the surrounding `finally` to run before the promise settles.

```ts
export async function loadWithContext<Value>(load: () => Promise<Value>): Promise<Value> {
  try {
    return await load();
  } catch (cause: unknown) {
    throw new Error("Unable to load the requested value", { cause });
  }
}
```

Clean up event listeners, timers, abort handlers, observers, and subscriptions. Use `finally` for cleanup. Do not return from `finally`. Do not replace an existing result or failure with an unrelated cleanup error; define a deliberate policy when cleanup itself can fail.

Accept and propagate an `AbortSignal` for cancellable long-running work when the underlying APIs support it. Cancellation is a distinct outcome; do not silently turn it into ordinary success or automatically retry it.

Retries must be bounded, limited to failures the operation can safely retry, and explicit about repeated side effects. Do not embed an invisible retry loop in a small data-access helper.

Avoid top-level `await` in reusable modules. Use it only at an explicit startup or tool boundary where blocking module evaluation is intentional.

Do not construct `new Promise` around an API that already returns a promise. Never use an `async` Promise executor.

## 20 Errors and results

### Throw useful errors

Throw `Error` instances or meaningful subclasses, never strings or arbitrary objects. Use standard subclasses such as `TypeError` and `RangeError` when they describe the problem accurately.

Use `cause` when adding context to an existing failure. Do not concatenate an error into a string and discard its identity.

Catch values as `unknown` and narrow them before reading properties. External code can throw values other than `Error`.

```ts
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "An unknown error occurred";
}
```

Error messages should identify the failed operation and useful safe context. Do not include credentials, tokens, complete request payloads, or sensitive data.

### Custom error classes

Create a custom error type when callers need to distinguish a meaningful failure category, carry structured diagnostic data, or offer a stable domain-specific operation. Use a built-in subclass such as `RangeError` or `TypeError` when its semantics fit. Extend `Error` for other failures. Use a shared abstract base only when several related errors actually share behavior or a common contract.

Custom errors must follow these conventions:

- Call `super(message, options)` so native message and `cause` behavior is preserved. Accept `ErrorOptions` instead of inventing a second cause field.
- Give each concrete type a stable `PascalCase` name ending in `Error`, and set `this.name` to that name. Do not depend on `constructor.name` or minified class names as an external identifier.
- Prefer `message` first and `options: ErrorOptions = {}` second. Additional error-specific context should have meaningful names and readonly types.
- Initialize properties in the constructor. Do not assign a fabricated string to `stack` or repeatedly throw and catch errors merely to obtain a trace.
- Where `Error.captureStackTrace` is available, use it to omit constructor and internal factory frames. Preserve the ordinary `Error`-provided stack on other engines. The exact stack format is not a public contract. [25]
- When a factory constructs an error, return that type explicitly. When a helper always throws, annotate it `never` and give it a verb or failure-oriented name. A `static` helper that does not use `this` should declare `this: void`.
- Expose stable readonly error codes or domain properties only when callers need them. Do not require callers to inspect message text or stack strings to distinguish variants.

Common package failures must have named static constructors or throw helpers, following `StorageKeyError.invalidFormat(...)`. Keep repeated message construction inside the error class. Do not add generic factories such as `WorkflowStepError.message(...)` or `OptionsError.fromMessage(...)`.

Normal package code uses the most specific error or named factory available. Direct base-error construction is reserved for record rehydration, tests, or open-ended user-supplied failures. Keep structured details when callers, logs, or serialized records need them.

The following pattern uses a single stack-capture helper. It checks for V8's API without requiring Node-specific types, and allows a factory or throw helper to identify the first useful stack frame:

```ts
type StackFrameStart = CallableFunction | NewableFunction;

function captureErrorStack(error: Error, start: StackFrameStart): void {
  if ("captureStackTrace" in Error && typeof Error.captureStackTrace === "function") {
    Error.captureStackTrace(error, start);
  }
}

export abstract class DomainError extends Error {
  protected constructor(
    name: string,
    message: string,
    options: ErrorOptions = {},
    stackStart?: StackFrameStart,
  ) {
    super(message, options);
    this.name = name;
    captureErrorStack(this, stackStart ?? new.target);
  }
}

export class TimeoutError extends DomainError {
  constructor(
    message = "The operation timed out",
    options: ErrorOptions = {},
    stackStart?: StackFrameStart,
  ) {
    super("TimeoutError", message, options, stackStart);
  }

  static waitingForService(this: void, options: ErrorOptions = {}): TimeoutError {
    return new TimeoutError(
      "Timed out while waiting for the service",
      options,
      TimeoutError.waitingForService,
    );
  }

  static deadlineExceeded(this: void, options: ErrorOptions = {}): never {
    throw new TimeoutError("Operation deadline exceeded", options, TimeoutError.deadlineExceeded);
  }
}
```

`super` supplies the normal stack even when `captureStackTrace` does not exist. In engines supporting the extra API, passing `TimeoutError.waitingForService` or `TimeoutError.deadlineExceeded` omits that helper and its internal calls; the trace starts with the application caller. Stack traces are attached when an error is constructed, not when it is later thrown. [25]

The optional `stackStart` constructor argument is for internal factories and throw helpers. Ordinary callers should use the message and options parameters. Keep this diagnostic plumbing out of application-level error handling.

An isolated error class may extend a built-in error directly, using the same constructor and stack conventions. A static predicate is useful when it meaningfully narrows the error, such as checking a structured code:

```ts
type OptionErrorCode = "INVALID_CAPACITY" | "INVALID_TIMEOUT";
type OptionsErrorOptions = ErrorOptions & { readonly code: OptionErrorCode };

export class OptionsError extends RangeError {
  readonly code: OptionErrorCode;

  constructor(
    message: string,
    options: OptionsErrorOptions,
    stackStart: StackFrameStart = OptionsError,
  ) {
    super(message, options);
    this.name = "OptionsError";
    this.code = options.code;
    captureErrorStack(this, stackStart);
  }

  static invalidCapacity(this: void): never {
    throw new OptionsError(
      "Capacity must be at least 1",
      { code: "INVALID_CAPACITY" },
      OptionsError.invalidCapacity,
    );
  }

  static isCapacityError(
    this: void,
    error: unknown,
  ): error is OptionsError & { readonly code: "INVALID_CAPACITY" } {
    return error instanceof OptionsError && error.code === "INVALID_CAPACITY";
  }
}
```

Prefer a direct `instanceof` check when the class alone establishes the condition; do not add redundant `isSomethingError` methods. A custom predicate must check everything its type promises. `instanceof` depends on object identity and may not survive separate realms, workers, or serialization. Use an explicit serialized error representation and validation at those boundaries.

Use `cause` to retain a lower-level error while adding context:

```ts
throw TimeoutError.waitingForService({
  cause: originalError,
});
```

Do not copy `cause` into the message, rewrite an existing stack string, or expose internal stacks and causes to clients. Native `ErrorOptions` lets custom subclasses retain the original cause through `super`. [26]

### Catch where the code can act

Catch only to recover, translate an error at a boundary, add meaningful context, perform a safe retry, or handle a lifecycle outcome.

Do not use empty catches. Do not catch an error and represent failed work as successful or return an undocumented placeholder. A valid fallback is allowed when it is part of the API's documented recovery contract. Do not convert every exception into `undefined` unless failure is explicitly part of that function's absence contract.

Handle expected domain alternatives with a discriminated result when callers must branch on them:

```ts
export type ReserveResult =
  | { readonly kind: "ok"; readonly reservationId: string }
  | {
      readonly kind: "error";
      readonly reason: "unavailable" | "limit-exceeded";
    };
```

Use exceptions for failures that should interrupt the operation. Keep the convention consistent within an API; do not report the same condition as a thrown error on one path and an error result on another.

Do not wrap every function in a custom result abstraction. Add one where it makes expected outcomes explicit. Where the surrounding package uses `Result`, reuse `@temelj/result` and its `kind: "ok"` and `kind: "error"` convention. Throw for programmer errors and invalid required state.

### Own reporting at boundaries

Report a failure at the layer that owns the response or lifecycle. Avoid logging and rethrowing the same failure through every layer.

Use an intentional structured logging contract for applications. A CLI may write intended output to standard output and diagnostics to standard error. Reusable libraries must not print incidental diagnostics as part of ordinary calls.

Translate internal errors into stable external responses. Do not expose stack traces, provider error objects, or internal storage records directly. Treat error causes as potentially sensitive when logging or serializing.

## 21 Comments and documentation

Write code whose names and structure explain the ordinary path. Use comments for constraints, reasons, invariants, tradeoffs, and non-obvious interoperability behavior.

Do not narrate what a statement already says. Remove commented-out code and stale explanations.

Use `//` for implementation comments and `/** ... */` for API documentation.

Document exported library APIs and any application contract whose meaning is not clear from its name and types. Explain units, mutation, absence, ordering, thrown failures, cancellation, and lifecycle obligations when relevant.

```ts
/**
 * Returns the delay before the next attempt, in milliseconds.
 *
 * The first retry is numbered zero; maxRetries excludes the initial attempt.
 * Returns undefined when the retry budget is exhausted. Does not wait or
 * schedule work.
 */
export function getRetryDelayMs(retryIndex: number, maxRetries: number): number | undefined {
  if (retryIndex >= maxRetries) {
    return undefined;
  }

  return 250 * 2 ** retryIndex;
}
```

Do not repeat TypeScript annotations in JSDoc with `{Type}` syntax. Use `@param` and `@returns` when they add semantic information. Use `@throws` to document intentional failure conditions without implying TypeScript checks them.

Keep examples small, valid ESM TypeScript, and consistent with the API. Document surprising behavior beside the declaration that owns it.

Update the package README when public usage changes. Remove stale examples, comments, export lists, and generated documentation in the same change that removes the code they describe.

A TODO must describe the missing work and a concrete trigger or issue reference. Do not leave anonymous reminders such as “fix later.” A permanent workaround should explain the constraint and its source.

Keep source comments in a consistent project language; use English by default for shared codebases. User-facing strings follow the product's localization policy.

## 22 Tests and fixtures

Tests must follow the same naming, formatting, type-safety, and promise rules as production code. Colocate Vitest tests in `src/` as `*.test.ts`, or `*.test.tsx` when they contain JSX. Import Vitest APIs explicitly. Use the package-local configuration when one exists.

Name test cases by observable behavior and the condition that matters: “returns no jobs when the queue is empty.” Avoid test names that merely repeat a private helper's name.

Keep setup, action, and assertion easy to distinguish. Use blank lines; add labels only when they help. A test should exercise one coherent behavior, though that behavior may need several assertions.

Use small, realistic, explicitly typed fixtures. Prefer `satisfies` to fixture casts. Do not create a valid-looking object with `{} as Account`.

Create fresh mutable fixtures for each test. Do not let one test depend on another test's state or execution order.

Control clocks, randomness, environment reads, and external services at their boundaries. Avoid arbitrary sleeps when a deterministic event or controllable clock is available.

Assert important returned values, state changes, and failures. Cover success, failure, edge cases, and public type contracts. Use `expectTypeOf` for compile-time public guarantees. Exercise behavior through the normal public API unless the helper is intentionally internal.

Avoid assertions about internal call sequences unless the sequence is part of the public contract. Do not assert generated implementation details unless the generated contract is the feature under test.

Await asynchronous assertions and operations. A passing test must not leave an unobserved promise that can reject after the test completes.

Use snapshots only when reviewing the full representation is meaningful. Prefer focused assertions for a few fields over a large opaque snapshot.

Use `@ts-expect-error` with an explanation in negative type tests. Such a directive is an intentional assertion that a program is rejected, not temporary production debt.

```ts
// @ts-expect-error -- Retry count must be numeric.
calculateRetryDelayMs("first", { maxRetries: 3, delayMs: 100 });
```

Keep type tests in a dedicated file or tool-supported type-test area. Do not execute intentionally invalid examples as ordinary runtime tests. Do not weaken fixtures with `any` or blanket casts.

### Generated code and fixtures

Do not hand-edit committed generated outputs. Change the generator, run the package-local generation command, and review the generated diff. For example, FFmpeg uses `pnpm --filter @temelj/ffmpeg script:generate`; MDX character entities use `pnpm --filter @temelj/mdx script:generate-entities`.

Generated artifacts need a committed, documented generator and a current consumer. Do not introduce generated code without that workflow. Remove the workflow and its outputs together when the consumer is deleted. Generated files may have wider types, larger tables, and comments that are unsuitable for handwritten source.

## 23 JSX and components

Apply this section to React-oriented packages such as `@temelj/react-hooks` and `@temelj/mdx-react`, and their examples. Keep React-specific dependencies and APIs in modules whose public contracts are explicitly React-oriented.

Use kebab-case `.tsx` filenames and PascalCase component names. Name the file after its primary component or cohesive component API.

Keep one primary component API per file. Small private render helpers and intentionally compound components may stay together. Extract independently reusable components into their own files.

Use a named props type when props need a reusable contract or would make the signature hard to read. Use discriminated unions for mutually exclusive modes instead of a large set of unrelated boolean props.

Keep JSX expressions small. Move substantial branching, parsing, and transformations into named values or functions. Do not put nested ternaries in markup.

Spread props only from a known, intentional contract. Make override order explicit. Do not pass an arbitrary internal object through a component boundary merely to save listing its fields.

Use stable identities for keyed collections. Follow the selected framework's lifecycle and purity rules. Keep asynchronous operations and mutations in the framework-supported boundary, rather than hiding them in expressions evaluated during rendering.

Use a framework-required default export only at the file where the framework requires it. Ordinary shared components use named exports.

### React hooks and lifecycle

Hook exports start with `use`. Keep hooks safe for server rendering. Guard browser-only APIs with the package's existing `isBrowser` utilities or equivalent checks.

Keep returned callbacks stable with `React.useCallback` when callers pass them to effects, children, or event listeners. Use refs for latest callback/value patterns when timers, observers, or listeners outlive a render.

Keep render pure. Do not mutate refs, external state, streams, or stores during render, or execute extension hooks or plugin pipelines there. Perform effects in an effect, event handler, or external-store boundary. Memoized computation is not an effect boundary.

Cancel obsolete asynchronous effect work when supported and ignore stale completions. Mock browser APIs in colocated jsdom tests and package test helpers instead of assuming the runtime provides them.

## 24 Enforcement and exceptions

### Automate what can be automated

Temelj must expose and run these checks in CI:

1. Formatting in check mode.
2. A type-aware lint check.
3. Full TypeScript checking for every handwritten compilation unit, including tests and scripts.
4. The project's relevant tests.
5. A build or execution check for the actual runtime profile.

Do not treat a successful build as proof that type checking ran. Do not type-check a single file in isolation as a substitute for the project's configured check.

Use `.oxfmtrc.json` as the formatter configuration. Oxfmt also sorts imports through `experimentalSortImports`; do not maintain a competing manual order.

Use `pnpm lint`, which runs `oxlint --type-aware`, as the lint authority, and `pnpm typecheck` as the type authority. Lint presets are not the full standard; rules that are not mechanically enforced still apply in review. Encode recurring mechanical rules in types, lint rules, generators, or scripts. Reserve prose for decisions that require judgment.

A practical enforcement map:

| Requirement                                  | Enforcement                                                  |
| -------------------------------------------- | ------------------------------------------------------------ |
| Strict checking and erasable syntax          | TypeScript configuration                                     |
| No enums, namespaces, or decorators          | Compiler where applicable plus syntax restrictions           |
| Kebab-case files                             | Filename rule or repository check, with tool-path exceptions |
| Braces, strict equality, no nested ternaries | Lint rules                                                   |
| Type-only imports and exports                | Typed lint rules and `verbatimModuleSyntax`                  |
| No explicit or propagated `any`              | No-explicit-any and unsafe-operation rules                   |
| No non-null or double assertions             | Assertion restrictions                                       |
| Handled promises and valid async callbacks   | Floating-promise and misused-promise checks                  |
| Exhaustive unions                            | `never` checks and an exhaustiveness lint rule               |
| No unused bindings                           | One configured lint owner                                    |
| Import boundaries and cycles                 | Import/dependency rules where feasible                       |
| Public contracts and justified exceptions    | Review plus targeted lint rules                              |

A broad recommended preset is a starting point, not a complete implementation of this guide. In particular, a rule that accepts `void promise` is insufficient to prove rejection handling. [19]

Configure unused-parameter handling consistently with the `_name` exception. Do not enable competing compiler and lint policies that disagree about the same case.

### Handle exceptions visibly

Permitted integration exceptions are specific: required filenames, required default exports, accurately scoped declaration files, contextual inference, and a necessary localized assertion.

For a lint suppression, identify the exact rule and explain the concrete reason on the smallest applicable line or block. Do not disable a rule for an entire file to avoid one diagnostic.

A temporary `@ts-expect-error` in production code must include the external limitation or tracked issue and a removal condition. Do not use it to skip implementing a correct contract. Do not use `@ts-ignore` or `@ts-nocheck`.

Keep generated-code exclusions narrow. Do not classify handwritten code as generated to evade checking.

Temelj's vendored anti-slop rules live in `scripts/oxlint/anti-slop/` and are enabled by `.oxlintrc.json`. The [provenance record](./scripts/oxlint/anti-slop/UPSTREAM.md) documents their source and approved boundary exceptions. Upgrade root `oxlint` and `@oxlint/plugins` together, pinned to the same exact version.

Foundational guards in `@temelj/value` may use runtime `typeof` under the scoped lint configuration. Arbitrary-value inspection, Standard Schema, MDX, and workflow parser boundaries have documented exceptions in that record. Keep parsed outputs and internal consumers typed; do not copy a boundary exception into ordinary internal code. Examples in this guide illustrate language rules, not blanket permission to bypass the repository's lint restrictions.

New exceptions that change the standard must be recorded in the project addendum or in an explicit revision of this guide. Individual files must not quietly introduce a different style. The ESM and erasable-syntax baseline remains mandatory.

## 25 Project configuration profiles

### Shared compiler baseline

Store this policy in `scripts/tsconfig.json`, inherited by package configurations and adapted for examples where needed. This is the required shared fragment, not a claim that every option is already enabled. The project addendum records the current configuration gaps.

```json
{
  "compilerOptions": {
    "strict": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,
    "allowUnreachableCode": false,
    "allowUnusedLabels": false,
    "forceConsistentCasingInFileNames": true
  }
}
```

The additional checks are intentional; `strict` does not include all of them. Select a compiler version that supports them; `erasableSyntaxOnly` was introduced in TypeScript 5.8. [2][20]

Set `noEmitOnError: true` wherever TypeScript emits output. Use `noEmit: true` for checking configurations where another tool owns JavaScript transformation or execution. A library may use a separate declaration build with `declaration: true` and `emitDeclarationOnly: true`; that build must not also set `noEmit: true`.

Choose `target`, `lib`, `types`, `jsx`, and output settings for the actual environment. Do not add DOM globals to a backend package or Node globals to browser code merely to silence a missing-name error.

Separate browser, server, worker, tooling, and test configurations when their available globals or module behavior differ. Each must inherit the shared checks.

Keep `skipLibCheck` off by default. If an upstream declaration issue requires enabling it temporarily, record the exact limitation and track its removal. It must not become a way to disable checking of handwritten application code.

Enable `resolveJsonModule` where needed. For side-effect asset imports, use accurate tool-provided declarations or narrowly scoped asset declarations. Do not use `declare module "*"` to make all unresolved imports pass. [21]

### Select an ESM profile

| Profile                              | Required module settings                                                                                 | Relative code imports             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------- |
| TypeScript emits JavaScript for Node | `module: "NodeNext"`, `moduleResolution: "NodeNext"`                                                     | Emitted extensions, usually `.js` |
| A bundler consumes TypeScript        | `module: "ESNext"`, `moduleResolution: "Bundler"`, `noEmit: true`, `allowImportingTsExtensions: true`    | Explicit `.ts` or `.tsx`          |
| Node executes TypeScript directly    | `module: "NodeNext"`, `moduleResolution: "NodeNext"`, `noEmit: true`, `allowImportingTsExtensions: true` | Actual `.ts` or `.mts`            |

These profiles make a deliberate style choice for each execution model. Verify the chosen bundler's extension handling and dependency interoperability. Use explicit ESM package metadata. [3][7]

For emitted Node code, source files import `"./worker.js"` even when the source is `worker.ts`. For direct TypeScript execution, import `"./worker.ts"`.

A project that intentionally executes TypeScript source and also emits JavaScript may adopt `rewriteRelativeImportExtensions: true` as a documented build variation. It rewrites supported relative TypeScript extensions; it does not fix arbitrary aliases or package mappings. [22]

Do not use `moduleResolution: "Bundler"` for code that must run as unbundled Node output merely because it accepts more import forms.

For a published package, verify the emitted JavaScript and declarations against the intended consumers. Define public exports explicitly. A successful development bundle does not prove that consumers can resolve the distributed package.

### Formatter policy

Oxfmt owns formatting in Temelj. These Prettier-compatible options express the core policy for `.oxfmtrc.json`:

```json
{
  "tabWidth": 2,
  "useTabs": false,
  "printWidth": 100,
  "semi": true,
  "singleQuote": false,
  "jsxSingleQuote": false,
  "trailingComma": "all",
  "arrowParens": "always",
  "bracketSpacing": true,
  "endOfLine": "lf"
}
```

Keep Oxfmt's import sorting configured alongside the formatting policy. Formatter defaults and lint presets are not substitutes for committing the intended settings. See the addendum for current configuration differences. [4]

### Temelj project addendum

#### Workspace and runtime

The pnpm workspace contains `lib/`, `packages/*`, and `examples/**`, with Turbo coordinating package commands. Use the pnpm version declared by root `package.json`'s `packageManager`. Dependency manifests and the lockfile record tool versions; do not copy version lists into this guide.

Every package uses `"type": "module"`. Packages may target Node, browsers, or specialized environments, and examples demonstrate their integrations. Keep available globals and runtime dependencies appropriate to the package. CI uses the Node version in `.github/workflows/test.yaml`.

#### Source checking and distribution

Package configurations generally extend `../../scripts/tsconfig.json`. The shared configuration uses `target: "esnext"`, `module: "esnext"`, `moduleResolution: "bundler"`, `noEmit: true`, and `allowImportingTsExtensions: true`.

Package source uses explicit `.ts` imports, or `.tsx` for JSX modules. Existing packages contain other suffix conventions; match nearby code and avoid import-only churn in unrelated changes. The examples in this guide use the source convention for new code.

Tsdown owns package JavaScript transformation with `unbundle: true`, `target: false`, and `sourcemap: false`, emitting a file per source module. Published npm entries use `.mjs` JavaScript and `.d.mts` declarations; JSR/Deno entries point to source through `deno.json`. Check emitted relative specifiers and package exports against actual consumers. The shared Bundler resolution works with this build transformation; it does not make source specifiers valid in raw Node output by itself.

Keep package `tsdown.config.ts` files identical unless the package has a specific reason to differ. Do not edit `dist/` by hand. Preserve the ESM and unbundled-build contract when changing exports or module initialization.

#### Integration conventions

Public source barrels are `mod.ts`, with explicit re-exports under section 7. Framework-required route names, directives, and default exports stay within the integrations that require them. Tool configurations and the MDX loader have the default-export allowances described in section 7.

Accept caller-provided validators through `@temelj/standard-schema`. Use the owning package's declared public API for other workspace utilities. Keep foundational aggregate exports in `lib/` intentional.

#### Commands and verification

| Purpose                | Command                                  |
| ---------------------- | ---------------------------------------- |
| Format                 | `pnpm format`                            |
| Check formatting       | `pnpm format:check`                      |
| Type-aware lint        | `pnpm lint`                              |
| Build                  | `pnpm build`                             |
| Type check             | `pnpm typecheck`                         |
| Test                   | `pnpm test`                              |
| Check JSR publishing   | `pnpm jsr:check`                         |
| Test one package       | `pnpm --filter @temelj/<name> test`      |
| Type check one package | `pnpm --filter @temelj/<name> typecheck` |

For TypeScript changes, run the smallest meaningful package command first. For shared behavior, exports, build configuration, or cross-package contracts, broaden to the CI sequence: build, type check, format/lint, JSR check, then tests. A targeted inspection is enough for narrow documentation changes.

Use package-local Vitest configurations where present. React-oriented packages use jsdom and shared browser mocks. Use fake timers or controlled promises for timing and concurrency tests.

#### Configuration differences to resolve

The shared compiler configuration currently enables `skipLibCheck` and omits several required checks shown above, including `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`. It also supplies Node and Vitest globals broadly. These are differences from the required baseline, not approved exceptions or reasons to weaken the rules. Reconcile them in a configuration change with package-level validation.

The current Oxfmt configuration specifies import sorting groups that differ from section 7 and relies on defaults for the formatting options shown above. Align its explicit options and sorting policy in a tooling change. Until then, let the committed sorter own formatting rather than manually fighting its output.

Oxlint currently enables `anti-slop/no-conditional-empty-object-spread`, which rejects the conditional object-spread example in section 16. Use explicit object construction for required property omission. Reconcile the lint restriction with the guide in a tooling change while preserving section 12's optional-property contracts.

Existing `export *` barrels also differ from section 7. Use explicit re-exports for new public APIs and align existing barrels when changing their API. A documentation update does not require an unrelated source migration.

## 26 Review checklist

Use this as a final review pass, alongside automated checks.

- Do names describe domain meaning, and do filenames use kebab-case?
- Does each module have a cohesive responsibility and a deliberately small public API?
- Are ESM imports, extensions, attributes, and type-only imports correct for the execution profile?
- Are public function contracts explicit without erasing useful inference?
- Do state models make invalid combinations difficult to express?
- Is untrusted data validated once at the appropriate boundary, with parsed output used afterward?
- Are absence, mutation, units, and serialization semantics visible in the contract?
- Are promises, cancellation, cleanup, and expected failures handled deliberately?
- Do custom errors preserve `cause`, name their failure clearly, and trim optional stack frames without relying on stack-string parsing?
- Do assertions and suppressions have a specific, reviewable justification?
- Do tests cover observable behavior without weakening the production type contract?

## 27 References

The prescriptions in this guide are project policy. Zod examples use the Zod 4 API. The references below support language and library behavior and provide further reading. Google's guide is an influence on the organization and use of explicit rules and examples; its environment-specific choices are not adopted wholesale. [1]

1. [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)
2. [TypeScript erasableSyntaxOnly](https://www.typescriptlang.org/tsconfig/erasableSyntaxOnly.html)
3. [Node.js TypeScript support](https://nodejs.org/api/typescript.html)
4. [Prettier options](https://prettier.io/docs/options)
5. [Node.js ECMAScript modules](https://nodejs.org/api/esm.html)
6. [TypeScript verbatimModuleSyntax](https://www.typescriptlang.org/tsconfig/verbatimModuleSyntax.html)
7. [TypeScript choosing compiler options](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html)
8. [TypeScript everyday types](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html)
9. [TypeScript satisfies operator](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#the-satisfies-operator)
10. [TypeScript exactOptionalPropertyTypes](https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html)
11. [TypeScript inferred type predicates](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-5.html#inferred-type-predicates)
12. [Zod 4 migration guide](https://zod.dev/v4/changelog)
13. [TypeScript narrowing and exhaustiveness](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking)
14. [Zod basic usage](https://zod.dev/basics)
15. [Zod schema API](https://zod.dev/api)
16. [Zod 4 boolean text parsing](https://zod.dev/v4#stringbool)
17. [TypeScript noUncheckedIndexedAccess](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html)
18. [TypeScript object types and readonly properties](https://www.typescriptlang.org/docs/handbook/2/objects.html#readonly-properties)
19. [typescript-eslint no-floating-promises](https://typescript-eslint.io/rules/no-floating-promises/)
20. [TypeScript 5.8 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-8.html)
21. [TypeScript noUncheckedSideEffectImports](https://www.typescriptlang.org/tsconfig/noUncheckedSideEffectImports.html)
22. [TypeScript rewriteRelativeImportExtensions](https://www.typescriptlang.org/tsconfig/rewriteRelativeImportExtensions.html)
23. [TypeScript resolveJsonModule](https://www.typescriptlang.org/tsconfig/resolveJsonModule.html)
24. [TypeScript module resolution and paths](https://www.typescriptlang.org/docs/handbook/modules/reference.html#paths-does-not-affect-emit)
25. [V8 stack trace API](https://v8.dev/docs/stack-trace-api)
26. [JavaScript Error constructor and cause](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/Error)
