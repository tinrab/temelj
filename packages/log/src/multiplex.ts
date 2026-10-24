import type { LogSink } from "./types.ts";

export function createMultiplexSink(sinks: LogSink[]): LogSink {
  return {
    write: (record) => {
      const writes: Promise<void>[] = [];
      const failures: unknown[] = [];

      for (const sink of sinks) {
        try {
          const write = sink.write(record);

          if (write !== undefined) {
            writes.push(write);
          }
        } catch (cause) {
          failures.push(cause);
        }
      }

      if (writes.length === 0) {
        throwWriteFailures(failures);

        return;
      }

      return Promise.allSettled(writes).then((results) => {
        for (const result of results) {
          if (result.status === "rejected") {
            failures.push(result.reason);
          }
        }

        throwWriteFailures(failures);
      });
    },
    flush: async () => {
      await Promise.all(sinks.map(async (sink) => await sink.flush?.()));
    },
    close: async () => {
      await Promise.all(sinks.map(async (sink) => await sink.close?.()));
    },
  };
}

function throwWriteFailures(failures: readonly unknown[]): void {
  if (failures.length === 1) {
    throw failures[0];
  }

  if (failures.length > 1) {
    throw new AggregateError(failures, "Multiple log sink writes failed");
  }
}
