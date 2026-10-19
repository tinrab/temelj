import type { LogSink } from "./types.ts";

export function createMultiplexSink(sinks: LogSink[]): LogSink {
  return {
    write: (record) => {
      const writes: Promise<void>[] = [];

      for (const sink of sinks) {
        const write = sink.write(record);

        if (write !== undefined) {
          writes.push(write);
        }
      }

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
