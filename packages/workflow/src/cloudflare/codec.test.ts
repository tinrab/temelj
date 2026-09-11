import "temporal-polyfill/global";
import { createSuperJsonStorageCodec } from "@temelj/storage";
import { expect, test } from "vitest";

import {
  decodeCloudflareWorkflowValue,
  encodeCloudflareWorkflowValue,
  parseCloudflareWorkflowEnvelope,
} from "./codec.ts";

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
    expect(decodeCloudflareWorkflowValue(encodeCloudflareWorkflowValue(value), "result")).toEqual(
      value,
    );
  }
});

test("Cloudflare transport validates raw envelopes and decoded payloads", () => {
  expect(() => encodeCloudflareWorkflowValue({ callback: () => {} })).toThrow("Invalid input");
  expect(() => decodeCloudflareWorkflowValue(42, "result")).toThrow(
    "result must be an encoded string",
  );
  const codec = createSuperJsonStorageCodec<number>();
  expect(() => decodeCloudflareWorkflowValue(codec.encode(NaN), "result")).toThrow("Invalid input");
  expect(() => parseCloudflareWorkflowEnvelope({ kind: "temelj-workflow", version: 2 })).toThrow(
    "not a valid Temelj workflow envelope",
  );
});
