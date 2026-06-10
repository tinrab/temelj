import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { expect, test } from "vitest";

import { createStorage } from "../storage.ts";
import { S3StorageEngine } from "./s3.ts";

const rustFsCredentials = {
  accessKeyId: "temelj-storage",
  secretAccessKey: "temelj-storage-secret",
};

test(
  "s3 engine stores values, scans prefixes, and expires keys",
  { tags: ["container"] },
  async () => {
    await using container = await startRustFsContainer();
    const endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`;
    const bucket = `temelj-storage-${Date.now()}`;
    const client = new S3Client({
      credentials: rustFsCredentials,
      endpoint,
      forcePathStyle: true,
      region: "us-east-1",
    });
    await client.send(new CreateBucketCommand({ Bucket: bucket }));

    const storage = createStorage({
      engine: new S3StorageEngine({
        bucket,
        client,
        prefix: "app",
      }),
    });

    try {
      await storage.set("users:1", { name: "Verso" });
      await storage.set("users:2", { name: "Maelle" });
      await storage.set("sessions:1", "active", { ttl: 100 });
      await storage.set("sessions:expired", "gone", { ttl: 0 });

      expect(await storage.get("users:1")).toEqual({ name: "Verso" });
      expect(await storage.getMany(["users:1", "missing", "sessions:1"])).toEqual([
        { name: "Verso" },
        undefined,
        "active",
      ]);
      expect(await storage.has("users:2")).toBe(true);
      expect(await storage.keys({ prefix: "users:" })).toEqual(["users:1", "users:2"]);
      expect(await storage.get("sessions:expired")).toBeUndefined();

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(await storage.get("sessions:1")).toBeUndefined();
      expect(await storage.delete("sessions:1")).toBe(false);

      expect(await storage.deleteMany(["users:1", "missing", "users:2"])).toBe(2);
      expect(await storage.keys()).toEqual([]);
    } finally {
      await storage.dispose();
      await emptyBucket(client, bucket);
      await client.send(new DeleteBucketCommand({ Bucket: bucket }));
      client.destroy();
    }
  },
);

test("s3 engine treats prefixes as literal strings", { tags: ["container"] }, async () => {
  await using container = await startRustFsContainer();
  const endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`;
  const bucket = `temelj-storage-literal-${Date.now()}`;
  const client = new S3Client({
    credentials: rustFsCredentials,
    endpoint,
    forcePathStyle: true,
    region: "us-east-1",
  });
  await client.send(new CreateBucketCommand({ Bucket: bucket }));

  const namespace = "temelj-storage-[literal]*?";
  const storage = createStorage({
    engine: new S3StorageEngine({
      bucket,
      client,
      prefix: namespace,
    }),
  });
  const adjacentStorage = createStorage({
    engine: new S3StorageEngine({
      bucket,
      client,
      prefix: namespace.replace("[literal]*?", "X"),
    }),
  });

  try {
    await storage.set("literal*:one", 1);
    await storage.set("literalX:two", 2);
    await adjacentStorage.set("literal*:outside", 3);

    expect(await storage.keys({ prefix: "literal*:" })).toEqual(["literal*:one"]);

    await storage.clear({ prefix: "literal*:" });
    expect(await storage.keys()).toEqual(["literalX:two"]);
    expect(await adjacentStorage.get("literal*:outside")).toBe(3);
  } finally {
    await storage.dispose();
    await adjacentStorage.dispose();
    await emptyBucket(client, bucket);
    await client.send(new DeleteBucketCommand({ Bucket: bucket }));
    client.destroy();
  }
});

async function startRustFsContainer() {
  const { GenericContainer, Wait } = await import("testcontainers");
  return new GenericContainer("rustfs/rustfs:latest")
    .withExposedPorts(9000)
    .withEnvironment({
      RUSTFS_ACCESS_KEY: rustFsCredentials.accessKeyId,
      RUSTFS_SECRET_KEY: rustFsCredentials.secretAccessKey,
      RUSTFS_ADDRESS: ":9000",
    })
    .withCommand(["/data"])
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
}

async function emptyBucket(client: S3Client, bucket: string): Promise<void> {
  let continuationToken: string | undefined;
  do {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      }),
    );
    continuationToken = result.IsTruncated === true ? result.NextContinuationToken : undefined;
    const keys = (result.Contents ?? [])
      .map((item) => item.Key)
      .filter((key): key is string => key !== undefined);
    await Promise.all(
      keys.map((key) => client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))),
    );
  } while (continuationToken !== undefined);
}
