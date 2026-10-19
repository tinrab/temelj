"use client";

import { useState, useSyncExternalStore } from "react";

import { MdxStreamStore, type MdxStreamStoreOptions, type MdxStreamView } from "./stream-store.ts";

export interface UseMdxStreamResult {
  readonly view: MdxStreamView;
  readonly append: MdxStreamStore["append"];
  readonly edit: MdxStreamStore["edit"];
  readonly complete: MdxStreamStore["complete"];
  readonly consume: MdxStreamStore["consume"];
  readonly reset: MdxStreamStore["reset"];
}

/** Options initialize the session. Use `reset` to start another document or change configuration. */
export function useMdxStream(initialOptions: MdxStreamStoreOptions = {}): UseMdxStreamResult {
  const [store] = useState(() => new MdxStreamStore(initialOptions));
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  return {
    view,
    append: store.append,
    edit: store.edit,
    complete: store.complete,
    consume: store.consume,
    reset: store.reset,
  };
}
