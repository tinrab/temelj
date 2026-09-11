import * as React from "react";

/** Keeps mutable collection instances stable and subscribes React to their mutations. */
export function useMutableCollection<T>(create: (notify: () => void) => T): T {
  const [store] = React.useState(() => {
    const listeners = new Set<() => void>();
    let revision = 0;

    const collection = create(() => {
      revision++;

      for (const listener of listeners) listener();
    });

    return {
      collection,
      getSnapshot: () => revision,
      getServerSnapshot: () => 0,
      subscribe: (listener: () => void) => {
        listeners.add(listener);

        return () => {
          listeners.delete(listener);
        };
      },
    };
  });

  React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);

  return store.collection;
}
