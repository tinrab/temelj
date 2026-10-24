import Database from "libsql";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

import { LibSqlStorageEngine } from "./libsql.ts";

type NativeClient = InstanceType<typeof Database>;

test("concurrent first operations share one native client and dispose closes it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "temelj-libsql-initialization-"));
  const path = join(directory, "storage.db");
  const seed = new Database(path);
  seed.exec("CREATE TABLE temelj_storage (key TEXT PRIMARY KEY, value TEXT, expires_at INTEGER)");
  seed.close();
  const clients = new Set<NativeClient>();
  // oxlint-disable-next-line typescript/unbound-method -- The spy invokes this original method with the native client as its receiver.
  const originalPrepare = Database.prototype.prepare;

  const prepare = vi.spyOn(Database.prototype, "prepare").mockImplementation(function (
    this: NativeClient,
    query: string,
  ) {
    clients.add(this);

    return originalPrepare.call(this, query);
  });

  const engine = new LibSqlStorageEngine({ path, format: "string" });

  try {
    await Promise.all(
      Array.from({ length: 8 }, (_, index) => engine.set(`key-${index}`, `value-${index}`)),
    );
    expect(clients.size).toBe(1);
    expect(await engine.get("key-7")).toBe("value-7");
    const client = [...clients][0];

    if (client === undefined) {
      throw new Error("Expected an initialized client");
    }

    const close = vi.spyOn(client, "close");
    await engine.dispose();
    expect(close).toHaveBeenCalledOnce();
  } finally {
    prepare.mockRestore();

    for (const client of clients) {
      client.close();
    }

    await rm(directory, { recursive: true, force: true });
  }
});
