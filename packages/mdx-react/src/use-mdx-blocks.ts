"use client";

import { useState, useSyncExternalStore } from "react";

import type { MdxStreamView } from "./stream-store.ts";

import { MdxBlockStore, type MdxBlockStoreOptions } from "./block-store.ts";

export interface UseMdxBlocksResult {
  readonly view: MdxStreamView;
  readonly apply: MdxBlockStore["apply"];
  readonly consume: MdxBlockStore["consume"];
  readonly reset: MdxBlockStore["reset"];
}

/** Renders block events from a server-side stream. Pass the view to `StreamContent`. */
export function useMdxBlocks(options: MdxBlockStoreOptions = {}): UseMdxBlocksResult {
  const [store] = useState(() => new MdxBlockStore(options));
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  return { view, apply: store.apply, consume: store.consume, reset: store.reset };
}
