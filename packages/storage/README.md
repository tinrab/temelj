<p align="center">
  <h1 align="center" style="text-decoration:none;">@temelj/storage</h1>
  <br/>
  <p align="center">
    Standard key-value storage interface.
  </p>
</p>

<p align="center">
  <a href="https://twitter.com/tinrab" rel="nofollow"><img src="https://img.shields.io/badge/created%20by-@tinrab-1d9bf0.svg" alt="Created by Tin Rabzelj"></a>
  <a href="https://jsr.io/@temelj/storage" rel="nofollow"><img src="https://jsr.io/badges/@temelj/storage" alt="jsr"></a>
  <a href="https://opensource.org/licenses/MIT" rel="nofollow"><img src="https://img.shields.io/github/license/tinrab/temelj" alt="License"></a>
</p>

<div align="center">
  <a href="https://jsr.io/@temelj/storage">jsr</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://www.npmjs.com/package/@temelj/storage">npm</a>
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
$ npm install @temelj/storage
# jsr
$ deno add jsr:@temelj/storage # or jsr add @temelj/storage
```

## Usage

`@temelj/storage` provides a common async storage API over different backing data stores.

Values use the SuperJSON codec by default, so JSON-compatible data, `Date`, `bigint`, `Map`, `Set`, `RegExp`, and `Uint8Array` values can be stored without choosing a codec.

```ts
import { createStorage } from "@temelj/storage";

const storage = createStorage();

await storage.setMany([
  { key: "users:1", value: { name: "Verso" } },
  { key: "users:2", value: { name: "Maelle" } },
  { key: "posts:1", value: { title: "Drafts" } },
]);

const user = await storage.get("users:1");
await storage.delete("users:1");
```

Use `try*` methods when failures should be handled as `Result` values with [@temelj/result](../result/) instead of throwing exceptions.

```ts
import { isOk } from "@temelj/result";

const result = await storage.tryGet("users:1");
if (isOk(result)) {
  console.log(result.value);
}
```

Typed item maps can describe known keys.

```ts
type AppStorage = {
  readonly "settings:theme": "dark" | "light";
  readonly "users:1": {
    readonly id: string;
    readonly name: string;
  };
};

const storage = createStorage<AppStorage>();

await storage.set("settings:theme", "dark");
const theme = await storage.get("settings:theme");
```

## Codecs

Choose a codec when the storage value type should be restricted or serialized differently.

```ts
import { createStorage, createTextStorageCodec } from "@temelj/storage";

const storage = createStorage({
  codec: createTextStorageCodec(),
});

await storage.set("message", "hello");
```

Available codecs are:

- `createSuperJsonStorageCodec` for rich JavaScript values. This is the default.
- `createJsonStorageCodec` for JSON-compatible values.
- `createPrimitivizedJsonStorageCodec` for values normalized through `@temelj/value`.
- `createTextStorageCodec` for strings.
- `createBytesStorageCodec` for `Uint8Array` values.

## Events and watching

Storage expose typed event listeners for local mutations.

```ts
const off = storage.on("storage:change", (event) => {
  if (event.type === "set") {
    console.log("updated", event.key);
  }
});

await storage.set("users:1", { name: "Aline" });
off();
```

Specific events are available as `storage:set`, `storage:set-many`, `storage:delete`, `storage:delete-many`, and `storage:clear`.
Use `storage:*` or `*` patterns to listen broadly.

```ts
const offSet = storage.once("storage:set", (event) => {
  console.log(event.key, event.source);
});

console.log(storage.listenerCount("storage:set"));
offSet();
storage.clearListeners();
```

Use `watch` when you also want to subscribe to engine-native change notifications.
This starts the engine watcher only while watch callbacks are active.

```ts
const unwatch = await storage.watch((event) => {
  console.log(event.type, event.source);
});

await storage.set("users:1", { name: "Renoir" });
await unwatch();
```

Events from storage methods use `source: "storage"`.
Events reported by an engine `watch` implementation use `source: "engine"`.

## Storage engines

You can choose between several storage engine providers or create your own.

### In-Memory Storage

In-memory storage is the default engine.

```ts
import { createStorage } from "@temelj/storage";

const storage = createStorage();

await storage.set("sessions:1", "active", { ttl: 60_000 });
```

You can also create the engine explicitly.

```ts
import { createInMemoryEngine, createStorage } from "@temelj/storage";

const storage = createStorage({
  engine: createInMemoryEngine(),
});
```

### File System Storage

File system storage stores one encoded value per file and supports literal storage keys, prefixes, and TTL metadata.

```ts
import { createStorage } from "@temelj/storage";
import { createFileSystemEngine } from "@temelj/storage/filesystem";

const storage = createStorage({
  engine: createFileSystemEngine({
    directory: "./.storage",
    prefix: "app",
  }),
});

await storage.set("users:1", { name: "Verso" });
```

### Redis Storage

Redis storage uses `ioredis`. Install the optional peer dependency when using this engine.

```ts
import { createStorage } from "@temelj/storage";
import { createRedisEngine } from "@temelj/storage/redis";

const storage = createStorage({
  engine: createRedisEngine({
    url: process.env.REDIS_URL,
    prefix: "app",
    scanCount: 100,
  }),
});

await storage.set("sessions:1", "active", { ttl: 60_000 });
```

### Cloudflare KV Storage

Cloudflare KV storage can use a Worker KV binding or the Cloudflare API client.
Install the optional peer dependency (`cloudflare`) when using client mode.

```ts
import { createStorage } from "@temelj/storage";
import { createCloudflareKvEngine, type CloudflareKvBinding } from "@temelj/storage/cloudflare";

export default {
  async fetch(
    _request: Request,
    env: { readonly STORAGE: CloudflareKvBinding },
  ): Promise<Response> {
    const storage = createStorage({
      engine: createCloudflareKvEngine({
        binding: env.STORAGE,
        prefix: "app",
      }),
    });

    await storage.set("users:1", { name: "Verso" });
    return Response.json(await storage.get("users:1"));
  },
};
```

Client mode uses `accountId`, `namespaceId`, and Cloudflare client options.

```ts
const storage = createStorage({
  engine: createCloudflareKvEngine({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    namespaceId: process.env.CLOUDFLARE_KV_NAMESPACE_ID,
  }),
});
```

### libSQL Storage

libSQL storage uses the `libsql` package.
Without a path or URL, it creates an in-memory database.

```ts
import { createStorage } from "@temelj/storage";
import { createLibSqlEngine } from "@temelj/storage/libsql";

const storage = createStorage({
  engine: createLibSqlEngine({
    path: "storage.db",
    prefix: "app",
  }),
});

await storage.set("users:1", { name: "Verso" });
await storage.dispose();
```

### Postgres Storage

Postgres storage uses the `postgres` package and lazily creates the storage table by default.

```ts
import { createStorage } from "@temelj/storage";
import { createPostgresEngine } from "@temelj/storage/postgres";

const storage = createStorage({
  engine: createPostgresEngine({
    url: process.env.DATABASE_URL,
    prefix: "app",
  }),
});

await storage.set("users:1", { name: "Verso" });
await storage.dispose();
```

### MySQL Storage

MySQL storage uses `mysql2/promise` and lazily creates the storage table by default.

```ts
import { createStorage } from "@temelj/storage";
import { createMySqlEngine } from "@temelj/storage/mysql";

const storage = createStorage({
  engine: createMySqlEngine({
    url: process.env.DATABASE_URL,
    prefix: "app",
  }),
});

await storage.set("users:1", { name: "Verso" });
await storage.dispose();
```

### Web Storage

Local storage and session storage both belong to the `localstorage` subpath.
Use these engines in browser environments or pass a compatible storage object explicitly.

```ts
import { createStorage } from "@temelj/storage";
import { createLocalStorageEngine, createSessionStorageEngine } from "@temelj/storage/localstorage";

const localStorageStore = createStorage({
  engine: createLocalStorageEngine({
    namespace: "app",
  }),
});

const sessionStorageStore = createStorage({
  engine: createSessionStorageEngine({
    namespace: "app",
  }),
});

await localStorageStore.set("settings:theme", "dark");
await sessionStorageStore.set("sessions:current", "active");
```

### IndexedDB Storage

IndexedDB storage is for browser environments where values should be stored asynchronously in an IndexedDB object store.

```ts
import { createStorage } from "@temelj/storage";
import { createIndexedDbEngine } from "@temelj/storage/indexeddb";

const storage = createStorage({
  engine: createIndexedDbEngine({
    databaseName: "app-storage",
    namespace: "app",
    storeName: "entries",
  }),
});

await storage.set("users:1", { name: "Verso" });
await storage.dispose();
```

### Custom Storage Engines

Custom engines implement the `StorageEngine` interface and store encoded `Uint8Array` values.
`createStorage` handles key validation, value codecs, typed keys, batch fallbacks, `try*` results, and error wrapping.

```ts
import { createStorage, type StorageEngine } from "@temelj/storage";

export function createMapStorageEngine(): StorageEngine {
  const values = new Map<string, Uint8Array>();

  return {
    name: "map",

    async get(key) {
      return values.get(key)?.slice();
    },

    async set(key, value) {
      values.set(key, value.slice());
    },

    async delete(key) {
      return values.delete(key);
    },

    async keys(options) {
      return [...values.keys()].filter(
        (key) => options?.prefix === undefined || key.startsWith(options.prefix),
      );
    },

    async clear(options) {
      for (const key of await this.keys(options)) {
        values.delete(key);
      }
    },
  };
}

const storage = createStorage({
  engine: createMapStorageEngine(),
});

await storage.set("users:1", { name: "Ada" });
```

Engines must implement `get`, `set`, `delete`, `keys`, and `clear`.
They can optionally implement `has`, `getMany`, `setMany`, `deleteMany`, `watch`, and `dispose` for more efficient behavior, native change notifications, or resource cleanup.
