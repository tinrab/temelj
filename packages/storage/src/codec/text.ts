import type { StorageCodec } from "../types.ts";

import { createIdentityStorageCodec } from "./identity.ts";

/**
 * Creates a UTF-8 text codec for string values.
 */
export function createTextStorageCodec(): StorageCodec<string, string> {
  return createIdentityStorageCodec<string>();
}
