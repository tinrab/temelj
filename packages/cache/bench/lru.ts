import { LRUCache as OtherLruCache } from "lru-cache";
import { LRUCache as MnemonistLRU, LRUCacheWithDelete as MnemonistLRUDelete } from "mnemonist";
import QuickLRU from "quick-lru";
import { Bench, type ConsoleTableConverter, type Task, formatNumber } from "tinybench";

import { LruCache } from "../src/lru.ts";

export interface BenchSizes {
  readonly capacity: number;
  readonly sample: number;
  readonly overfill: number;
}

const BASELINE_NAME = "@temelj/cache (LruCache)";

function getMeanThroughput(task: Task): number | undefined {
  const r = task.result as unknown as { state: string; throughput?: { mean: number } };
  if (
    (r.state === "completed" || r.state === "aborted-with-statistics") &&
    r.throughput !== undefined
  ) {
    return r.throughput.mean;
  }
}

function getMeanLatency(task: Task): number | undefined {
  const r = task.result as unknown as { state: string; latency?: { mean: number } };
  if (
    (r.state === "completed" || r.state === "aborted-with-statistics") &&
    r.latency !== undefined
  ) {
    return r.latency.mean;
  }
}

function baselineConverter(bench: Bench): ConsoleTableConverter {
  const baselineTask = bench.tasks.find((t) => t.name === BASELINE_NAME);
  const baselineThroughput =
    baselineTask !== undefined ? (getMeanThroughput(baselineTask) ?? 1) : 1;

  return (task: Task): Record<string, number | string> => {
    const thr = getMeanThroughput(task);
    const lat = getMeanLatency(task);
    if (thr === undefined || lat === undefined) {
      return {
        "Task name": task.name,
        "Latency avg (µs)": "N/A",
        "Throughput avg (ops/s)": "N/A",
        "vs baseline": "N/A",
      };
    }

    const latUs = lat * 1_000;
    const ratio = thr / baselineThroughput;
    const sign = ratio >= 1 ? "+" : "";
    const pct = `${sign}${((ratio - 1) * 100).toFixed(1)}%`;

    const isWin = ratio <= 0.995;
    const badge = task.name === BASELINE_NAME ? "—" : isWin ? `${pct} 🥇` : pct;

    return {
      "Task name": task.name,
      "Latency avg (µs)": `${formatNumber(latUs, 4, 1)}`,
      "Throughput avg (ops/s)": Math.round(thr).toString(),
      "vs baseline": badge,
    };
  };
}

function logBaselineTable(bench: Bench, heading: string): void {
  const rows = bench.tasks.map(baselineConverter(bench)) as Record<string, string>[];
  const headers = ["Task name", "Latency avg (µs)", "Throughput avg (ops/s)", "vs baseline"];

  console.log(`\n### ${heading}`);
  console.log(`| ${headers.join(" | ")} |`);
  console.log(`|${headers.map(() => "---").join(" | ")}|`);
  for (const row of rows) {
    console.log(`| ${headers.map((h) => row[h]).join(" | ")} |`);
  }
}

function populate(cache: { set(key: string, value: number): unknown }, size: number): string[] {
  const keys: string[] = [];
  for (let i = 0; i < size; i++) {
    const key = `key:${i}`;
    keys.push(key);
    cache.set(key, i);
  }
  return keys;
}

function prepareKeys(size: number): string[] {
  const keys: string[] = [];
  for (let i = 0; i < size; i++) {
    keys.push(`key:${i}`);
  }
  return keys;
}

function runSet(capacity: number, sample: number) {
  const keys = prepareKeys(sample);
  return async (): Promise<void> => {
    const bench = new Bench({ time: 200 });

    bench
      .add("@temelj/cache (LruCache)", () => {
        const c = new LruCache<string, number>({ maxEntries: capacity });
        for (let i = 0; i < sample; i++) {
          c.set(keys[i], i);
        }
      })
      .add("lru-cache", () => {
        const c = new OtherLruCache<string, number>({ max: capacity });
        for (let i = 0; i < sample; i++) {
          c.set(keys[i], i);
        }
      })
      .add("quick-lru", () => {
        const c = new QuickLRU<string, number>({ maxSize: capacity });
        for (let i = 0; i < sample; i++) {
          c.set(keys[i], i);
        }
      })
      .add("mnemonist (LRUCache)", () => {
        const c = new MnemonistLRU<string, number>(capacity);
        for (let i = 0; i < sample; i++) {
          c.set(keys[i], i);
        }
      });

    await bench.run();
    logBaselineTable(bench, "set — sequential writes up to capacity");
  };
}

function runGetHit(capacity: number, sample: number) {
  const keys = prepareKeys(sample);
  return async (): Promise<void> => {
    const bench = new Bench({ time: 200 });

    const temelj = new LruCache<string, number>({ maxEntries: capacity });
    populate(temelj, capacity);

    const vendor = new OtherLruCache<string, number>({ max: capacity });
    populate(vendor, capacity);

    const quick = new QuickLRU<string, number>({ maxSize: capacity });
    populate(quick, capacity);

    const mnem = new MnemonistLRU<string, number>(capacity);
    populate(mnem, capacity);

    bench
      .add("@temelj/cache (LruCache)", () => {
        for (let i = 0; i < sample; i++) {
          temelj.get(keys[i]);
        }
      })
      .add("lru-cache", () => {
        for (let i = 0; i < sample; i++) {
          vendor.get(keys[i]);
        }
      })
      .add("quick-lru", () => {
        for (let i = 0; i < sample; i++) {
          quick.get(keys[i]);
        }
      })
      .add("mnemonist (LRUCache)", () => {
        for (let i = 0; i < sample; i++) {
          mnem.get(keys[i]);
        }
      });

    await bench.run();
    logBaselineTable(bench, "get (hit) — sequential reads of existing keys");
  };
}

function runGetMiss(capacity: number, sample: number) {
  const keys = prepareKeys(sample);
  return async (): Promise<void> => {
    const bench = new Bench({ time: 200 });

    const temelj = new LruCache<string, number>({ maxEntries: capacity });
    const vendor = new OtherLruCache<string, number>({ max: capacity });
    const quick = new QuickLRU<string, number>({ maxSize: capacity });
    const mnem = new MnemonistLRU<string, number>(capacity);

    bench
      .add("@temelj/cache (LruCache)", () => {
        for (let i = 0; i < sample; i++) {
          temelj.get(keys[i]);
        }
      })
      .add("lru-cache", () => {
        for (let i = 0; i < sample; i++) {
          vendor.get(keys[i]);
        }
      })
      .add("quick-lru", () => {
        for (let i = 0; i < sample; i++) {
          quick.get(keys[i]);
        }
      })
      .add("mnemonist (LRUCache)", () => {
        for (let i = 0; i < sample; i++) {
          mnem.get(keys[i]);
        }
      });

    await bench.run();
    logBaselineTable(bench, "get (miss) — sequential reads of missing keys");
  };
}

function runUpdate(capacity: number, sample: number) {
  const keys = prepareKeys(sample);
  return async (): Promise<void> => {
    const bench = new Bench({ time: 200 });

    const temelj = new LruCache<string, number>({ maxEntries: capacity });
    populate(temelj, capacity);

    const vendor = new OtherLruCache<string, number>({ max: capacity });
    populate(vendor, capacity);

    const quick = new QuickLRU<string, number>({ maxSize: capacity });
    populate(quick, capacity);

    const mnem = new MnemonistLRU<string, number>(capacity);
    populate(mnem, capacity);

    bench
      .add("@temelj/cache (LruCache)", () => {
        for (let i = 0; i < sample; i++) {
          temelj.set(keys[i], -i);
        }
      })
      .add("lru-cache", () => {
        for (let i = 0; i < sample; i++) {
          vendor.set(keys[i], -i);
        }
      })
      .add("quick-lru", () => {
        for (let i = 0; i < sample; i++) {
          quick.set(keys[i], -i);
        }
      })
      .add("mnemonist (LRUCache)", () => {
        for (let i = 0; i < sample; i++) {
          mnem.set(keys[i], -i);
        }
      });

    await bench.run();
    logBaselineTable(bench, "update — overwrite values for existing keys");
  };
}

function runMixed(capacity: number, sample: number) {
  const keys = prepareKeys(sample);
  return async (): Promise<void> => {
    const bench = new Bench({ time: 200 });

    const temelj = new LruCache<string, number>({ maxEntries: capacity });
    populate(temelj, capacity);

    const vendor = new OtherLruCache<string, number>({ max: capacity });
    populate(vendor, capacity);

    const quick = new QuickLRU<string, number>({ maxSize: capacity });
    populate(quick, capacity);

    const mnem = new MnemonistLRU<string, number>(capacity);
    populate(mnem, capacity);

    bench
      .add("@temelj/cache (LruCache)", () => {
        for (let i = 0; i < sample; i++) {
          if (i % 2 === 0) {
            temelj.get(keys[i]);
          } else {
            temelj.set(keys[i], -i);
          }
        }
      })
      .add("lru-cache", () => {
        for (let i = 0; i < sample; i++) {
          if (i % 2 === 0) {
            vendor.get(keys[i]);
          } else {
            vendor.set(keys[i], -i);
          }
        }
      })
      .add("quick-lru", () => {
        for (let i = 0; i < sample; i++) {
          if (i % 2 === 0) {
            quick.get(keys[i]);
          } else {
            quick.set(keys[i], -i);
          }
        }
      })
      .add("mnemonist (LRUCache)", () => {
        for (let i = 0; i < sample; i++) {
          if (i % 2 === 0) {
            mnem.get(keys[i]);
          } else {
            mnem.set(keys[i], -i);
          }
        }
      });

    await bench.run();
    logBaselineTable(bench, "mixed — 50/50 get hit + update");
  };
}

function runEviction(capacity: number, overfill: number) {
  return async (): Promise<void> => {
    const bench = new Bench({ time: 200 });

    bench
      .add("@temelj/cache (LruCache)", () => {
        const c = new LruCache<string, number>({ maxEntries: capacity });
        for (let i = 0; i < overfill; i++) {
          c.set(`key:${i}`, i);
        }
      })
      .add("lru-cache", () => {
        const c = new OtherLruCache<string, number>({ max: capacity });
        for (let i = 0; i < overfill; i++) {
          c.set(`key:${i}`, i);
        }
      })
      .add("quick-lru", () => {
        const c = new QuickLRU<string, number>({ maxSize: capacity });
        for (let i = 0; i < overfill; i++) {
          c.set(`key:${i}`, i);
        }
      })
      .add("mnemonist (LRUCache)", () => {
        const c = new MnemonistLRU<string, number>(capacity);
        for (let i = 0; i < overfill; i++) {
          c.set(`key:${i}`, i);
        }
      });

    await bench.run();
    logBaselineTable(bench, "eviction — write 2x capacity (forces evictions)");
  };
}

function runZigzag(capacity: number, sample: number) {
  const keys = prepareKeys(sample);
  return async (): Promise<void> => {
    const bench = new Bench({ time: 200 });

    const temelj = new LruCache<string, number>({ maxEntries: capacity });
    populate(temelj, capacity);

    const vendor = new OtherLruCache<string, number>({ max: capacity });
    populate(vendor, capacity);

    const quick = new QuickLRU<string, number>({ maxSize: capacity });
    populate(quick, capacity);

    const mnem = new MnemonistLRU<string, number>(capacity);
    populate(mnem, capacity);

    bench
      .add("@temelj/cache (LruCache)", () => {
        for (let i = 0; i < sample; i++) {
          temelj.get(keys[i]);
          temelj.get(keys[sample - 1 - i]);
        }
      })
      .add("lru-cache", () => {
        for (let i = 0; i < sample; i++) {
          vendor.get(keys[i]);
          vendor.get(keys[sample - 1 - i]);
        }
      })
      .add("quick-lru", () => {
        for (let i = 0; i < sample; i++) {
          quick.get(keys[i]);
          quick.get(keys[sample - 1 - i]);
        }
      })
      .add("mnemonist (LRUCache)", () => {
        for (let i = 0; i < sample; i++) {
          mnem.get(keys[i]);
          mnem.get(keys[sample - 1 - i]);
        }
      });

    await bench.run();
    logBaselineTable(bench, "zigzag — alternating head/tail reads");
  };
}

function runDelete(capacity: number, sample: number) {
  const keys = prepareKeys(sample);
  return async (): Promise<void> => {
    const bench = new Bench({ time: 200 });

    bench
      .add("@temelj/cache (LruCache)", () => {
        const c = new LruCache<string, number>({ maxEntries: capacity });
        populate(c, capacity);
        for (let i = 0; i < sample; i++) {
          c.delete(keys[i]);
        }
      })
      .add("lru-cache", () => {
        const c = new OtherLruCache<string, number>({ max: capacity });
        populate(c, capacity);
        for (let i = 0; i < sample; i++) {
          c.delete(keys[i]);
        }
      })
      .add("quick-lru", () => {
        const c = new QuickLRU<string, number>({ maxSize: capacity });
        populate(c, capacity);
        for (let i = 0; i < sample; i++) {
          c.delete(keys[i]);
        }
      })
      .add("mnemonist (LRUCacheWithDelete)", () => {
        const c = new MnemonistLRUDelete<string, number>(capacity);
        populate(c, capacity);
        for (let i = 0; i < sample; i++) {
          c.delete(keys[i]);
        }
      });

    await bench.run();
    logBaselineTable(bench, "delete — remove existing keys");
  };
}

function runHas(capacity: number, sample: number) {
  const keys = prepareKeys(sample);
  return async (): Promise<void> => {
    const bench = new Bench({ time: 200 });

    const temelj = new LruCache<string, number>({ maxEntries: capacity });
    populate(temelj, capacity);

    const vendor = new OtherLruCache<string, number>({ max: capacity });
    populate(vendor, capacity);

    const quick = new QuickLRU<string, number>({ maxSize: capacity });
    populate(quick, capacity);

    const mnem = new MnemonistLRU<string, number>(capacity);
    populate(mnem, capacity);

    bench
      .add("@temelj/cache (LruCache)", () => {
        for (let i = 0; i < sample; i++) {
          temelj.has(keys[i]);
        }
      })
      .add("lru-cache", () => {
        for (let i = 0; i < sample; i++) {
          vendor.has(keys[i]);
        }
      })
      .add("quick-lru", () => {
        for (let i = 0; i < sample; i++) {
          quick.has(keys[i]);
        }
      })
      .add("mnemonist (LRUCache)", () => {
        for (let i = 0; i < sample; i++) {
          mnem.has(keys[i]);
        }
      });

    await bench.run();
    logBaselineTable(bench, "has — check existing keys");
  };
}

export function createBenchSuite(sizes: BenchSizes): Record<string, () => Promise<void>> {
  return {
    set: runSet(sizes.capacity, sizes.sample),
    "get-hit": runGetHit(sizes.capacity, sizes.sample),
    "get-miss": runGetMiss(sizes.capacity, sizes.sample),
    update: runUpdate(sizes.capacity, sizes.sample),
    mixed: runMixed(sizes.capacity, sizes.sample),
    eviction: runEviction(sizes.capacity, sizes.overfill),
    zigzag: runZigzag(sizes.capacity, sizes.sample),
    delete: runDelete(sizes.capacity, sizes.sample),
    has: runHas(sizes.capacity, sizes.sample),
  };
}
