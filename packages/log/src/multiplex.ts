import type { LogSink } from "./types.ts";

import { isPromiseLike } from "./utility.ts";

export function createMultiplexSink(sinks: LogSink[]): LogSink {
  return {
    write: (record) => {
      const writes = sinks.map((sink) => sink.write(record)).filter(isPromiseLike);
      return writes.length === 0 ? undefined : Promise.all(writes).then(() => {});
    },
    flush: async () => {
      await Promise.all(sinks.map(async (sink) => await sink.flush?.()));
    },
    close: async () => {
      await Promise.all(sinks.map(async (sink) => await sink.close?.()));
    },
  };
}
