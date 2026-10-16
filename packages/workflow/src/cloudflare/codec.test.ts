import "temporal-polyfill/global";
import { createSuperJsonStorageCodec } from "@temelj/storage";
import { expect, test } from "vitest";

import { decodeCloudflareValue, encodeCloudflareValue, parseCloudflareEnvelope } from "./codec.ts";

test("Cloudflare transport round-trips supported values and absent results", () => {
  for (const value of [
    undefined,
    42,
    {
      date: new Date(0),
      instant: Temporal.Instant.fromEpochMilliseconds(0),
      entries: new Map([["key", 1]]),
    },
  ]) {
    expect(decodeCloudflareValue(encodeCloudflareValue(value), "result")).toEqual(value);
  }
});

test("Cloudflare transport validates raw envelopes and decoded payloads", () => {
  expect(() => encodeCloudflareValue({ callback: () => {} })).toThrow(
    "function values are not supported",
  );
  expect(() => decodeCloudflareValue(42, "result")).toThrow("result must be an encoded string");
  const codec = createSuperJsonStorageCodec<number>();
  expect(() => decodeCloudflareValue(codec.encode(NaN), "result")).toThrow("finite");
  expect(() => parseCloudflareEnvelope({ kind: "temelj-workflow", version: 2 })).toThrow(
    "not a valid Temelj workflow envelope",
  );
});
