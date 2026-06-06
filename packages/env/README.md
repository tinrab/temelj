<p align="center">
  <h1 align="center" style="text-decoration:none;">@temelj/env</h1>
  <br/>
  <p align="center">
    Type-safe environment variable parsing.
  </p>
</p>

<p align="center">
  <a href="https://twitter.com/tinrab" rel="nofollow"><img src="https://img.shields.io/badge/created%20by-@tinrab-1d9bf0.svg" alt="Created by Tin Rabzelj"></a>
  <a href="https://jsr.io/@temelj/env" rel="nofollow"><img src="https://jsr.io/badges/@temelj/env" alt="jsr"></a>
  <a href="https://opensource.org/licenses/MIT" rel="nofollow"><img src="https://img.shields.io/github/license/tinrab/temelj" alt="License"></a>
</p>

<div align="center">
  <a href="https://jsr.io/@temelj/env">jsr</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://www.npmjs.com/package/@temelj/env">npm</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://github.com/tinrab/temelj/issues/new">Issues</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://twitter.com/tinrab">@tinrab</a>
  <br />
</div>

<br/>
<br/>

## Installation

```sh
# npm
$ npm install @temelj/env
# jsr
$ deno add jsr:@temelj/env # or jsr add @temelj/env
```

## Usage

`@temelj/env` accepts any validator that implements [Standard Schema](https://github.com/standard-schema/standard-schema).
Zod, Valibot, ArkType, Typia, and similar libraries can be used as long as they expose the standard interface.

Temelj also provides `@temelj/standard-schema` for common Standard Schema validators:

```ts
import { parseEnv } from "@temelj/env";
import { ss } from "@temelj/standard-schema";

const env = parseEnv({
  BASE_URL: ss.string(),
  DEV: ss.boolean(),
});
```

Use `parseEnv` when invalid configuration should fail fast.

```ts
import { parseEnv } from "@temelj/env";
import { z } from "zod";

const env = parseEnv({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]),
  FEATURE_ENABLED: z.boolean().default(false),
});
```

String values are normalized before validation:

```ts
parseEnv(
  {
    PORT: z.coerce.number(),
    DEBUG: z.boolean(),
    HOST: z.string().default("localhost"),
  },
  {
    env: {
      PORT: " 4000 ",
      DEBUG: "true",
      HOST: "",
    },
  },
);
// => { PORT: 4000, DEBUG: true, HOST: "localhost" }
```

By default, string values are trimmed, `"true"` and `"false"` are converted to booleans, and empty strings are treated as `undefined` so schema defaults can apply.

Use `tryParseEnv` when you want to handle validation without exceptions.

```ts
import { tryParseEnv } from "@temelj/env";
import { isErr, unwrap } from "@temelj/result";
import { z } from "zod";

const envResult = tryParseEnv({
  DATABASE_URL: z.string().url(),
  NODE_ENV: z.enum(["development", "production", "test"]),
});

if (isErr(envResult)) {
  console.error(envResult.error.issues);
  process.exit(1);
}

const env = unwrap(envResult);
```

If no source is provided, `@temelj/env` reads from `process.env` on the server and `import.meta.env` in the browser.
You can pass a source explicitly:

```ts
const env = parseEnv(
  {
    VITE_API_URL: z.string().url(),
  },
  {
    env: import.meta.env,
  },
);
```

Use `createEnv` to keep server-only variables out of client parses.
Client keys must use the configured prefix.

```ts
import { createEnv } from "@temelj/env";
import { z } from "zod";

const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    SESSION_SECRET: z.string().min(32),
  },
  client: {
    VITE_API_URL: z.string().url(),
  },
  shared: {
    NODE_ENV: z.enum(["development", "production", "test"]),
  },
  clientPrefix: "VITE_",
  env: import.meta.env,
});
```

On the server, `createEnv` parses `server`, `client`, and `shared` schemas.
On the client, it parses only `client` and `shared`, so server variables are not returned.

```ts
const clientEnv = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
  },
  client: {
    VITE_API_URL: z.string().url(),
  },
  clientPrefix: "VITE_",
  isServer: false,
  env: import.meta.env,
});

clientEnv.VITE_API_URL;
// clientEnv.DATABASE_URL is not part of the client result type.
```

Use `tryCreateEnv` for the same server/client split with a `Result` return.

Use the async variants when a Standard Schema validator performs asynchronous validation.

```ts
const env = await parseEnvAsync(
  {
    TOKEN: z.string().refine(async (value) => value.length > 0),
  },
  {
    env: process.env,
  },
);
```

The non-throwing async APIs are `tryParseEnvAsync` and `tryCreateEnvAsync`.
