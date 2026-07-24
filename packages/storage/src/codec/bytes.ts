import type { StorageCodec } from "../types.ts";

import { createIdentityStorageCodec } from "./identity.ts";

/**
 * Creates a codec that stores `Uint8Array` values as raw bytes.
 */
export function createBytesStorageCodec(): StorageCodec<Uint8Array, Uint8Array> {
  return createIdentityStorageCodec<Uint8Array>();
}
