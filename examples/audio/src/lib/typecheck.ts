export type TypeDiagnostic = {
  readonly line: number | undefined;
  readonly column: number | undefined;
  readonly message: string;
};

export type TypeCheckRequest = {
  readonly id: number;
  readonly code: string;
};

export type TypeCheckResponse =
  | { readonly id: number; readonly diagnostics: readonly TypeDiagnostic[] }
  | { readonly id: number; readonly error: string };

/**
 * Type-checks playground programs in a Web Worker against the published @temelj/audio typings.
 * The worker (and the TypeScript compiler inside it) loads on first use.
 */
export class TypeChecker {
  #worker: Worker | undefined;
  #nextId = 0;
  #pending = new Map<number, (response: TypeCheckResponse) => void>();

  check(code: string): Promise<TypeCheckResponse> {
    const worker = this.#ensureWorker();
    const id = ++this.#nextId;

    return new Promise((resolve) => {
      this.#pending.set(id, resolve);
      worker.postMessage({ code, id } satisfies TypeCheckRequest);
    });
  }

  /**
   * Whether `id` belongs to the most recent request; older results are stale.
   */
  isLatest(id: number): boolean {
    return id === this.#nextId;
  }

  dispose(): void {
    this.#worker?.terminate();
    this.#worker = undefined;
    this.#pending.clear();
  }

  #ensureWorker(): Worker {
    if (this.#worker !== undefined) {
      return this.#worker;
    }

    const worker = new Worker(new URL("./typecheck.worker.ts", import.meta.url), {
      type: "module",
    });

    worker.onmessage = (event: MessageEvent<TypeCheckResponse>) => {
      const resolve = this.#pending.get(event.data.id);
      this.#pending.delete(event.data.id);
      resolve?.(event.data);
    };

    this.#worker = worker;

    return worker;
  }
}
