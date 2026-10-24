import Cloudflare from "cloudflare";
import { expect, test, vi } from "vitest";

import { CloudflareD1StorageEngine } from "./d1.ts";
import { CloudflareKvStorageEngine } from "./kv.ts";
import { CloudflareR2StorageEngine } from "./r2.ts";

test.each(["kv", "d1", "r2"] as const)(
  "concurrent first %s operations share one native API client",
  async (name) => {
    const clients = new Set<Cloudflare>();
    // oxlint-disable-next-line typescript/unbound-method -- The original is invoked with the observed SDK client as its receiver.
    const originalBuildURL = Cloudflare.prototype.buildURL;

    const buildURL = vi.spyOn(Cloudflare.prototype, "buildURL").mockImplementation(function (
      this: Cloudflare,
      ...args: Parameters<Cloudflare["buildURL"]>
    ) {
      clients.add(this);

      return originalBuildURL.call(this, ...args);
    });

    const options = {
      format: "string" as const,
      accountId: "account",
      apiToken: "test-token",
      fetch: async () =>
        new Response(
          name === "d1"
            ? JSON.stringify({ success: true, result: [{ success: true, results: [] }] })
            : "value",
          {
            status: name === "r2" ? 404 : 200,
            headers: {
              "content-type": name === "d1" ? "application/json" : "application/octet-stream",
            },
          },
        ),
    };

    const engine =
      name === "kv"
        ? new CloudflareKvStorageEngine({ ...options, namespaceId: "namespace" })
        : name === "d1"
          ? new CloudflareD1StorageEngine({ ...options, databaseId: "database" })
          : new CloudflareR2StorageEngine({ ...options, bucketName: "bucket" });

    try {
      await Promise.all(Array.from({ length: 8 }, (_, index) => engine.get(`key-${index}`)));
      expect(clients.size).toBe(1);
    } finally {
      buildURL.mockRestore();
    }
  },
);
