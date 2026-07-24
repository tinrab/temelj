import { type WebStorageLike } from "@temelj/storage/localstorage";

export function createMockWebStorage(): WebStorageLike {
  const items = new Map<string, string>();
  return {
    get length(): number {
      return items.size;
    },
    clear: vi.fn<() => void>(() => {
      items.clear();
    }),
    getItem: vi.fn<(key: string) => string | null>(
      (key: string): string | null => items.get(key) ?? null,
    ),
    key: vi.fn<(index: number) => string | null>(
      (index: number): string | null => [...items.keys()][index] ?? null,
    ),
    removeItem: vi.fn<(key: string) => void>((key: string) => {
      items.delete(key);
    }),
    setItem: vi.fn<(key: string, value: string) => void>((key: string, value: string) => {
      items.set(key, value);
    }),
  };
}
