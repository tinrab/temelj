import type {
  MdxEdit,
  MdxStreamChange,
  MdxStreamCompletion,
  MdxStreamOptions,
  MdxStreamSnapshot,
} from "./stream-types.ts";

import { ConfigurationError, InputError } from "./errors.ts";
import { resolveParserLimits } from "./parser/config.ts";
import { StreamSession } from "./stream-session.ts";

const defaultMaximumPendingBlockLength = 4 * 1024 * 1024;

/**
 * Parses a document while it arrives. Each append renders only the open tail;
 * settled blocks keep their identity, so renderers update only what changed.
 */
export class MdxStream {
  readonly #session: StreamSession;
  readonly #listeners = new Set<(change: MdxStreamChange) => void>();
  #completion: Extract<MdxStreamCompletion, { kind: "ok" }> | undefined;

  public constructor(options: MdxStreamOptions = {}) {
    const { maximumPendingBlockLength = defaultMaximumPendingBlockLength, ...limits } =
      options.limits ?? {};

    if (!Number.isSafeInteger(maximumPendingBlockLength) || maximumPendingBlockLength < 1) {
      ConfigurationError.invalidStreamLimit(
        "maximumPendingBlockLength",
        maximumPendingBlockLength,
        1,
      );
    }

    this.#session = new StreamSession({
      name: options.name ?? "source.mdx",
      source: options.source ?? "",
      syntax: options.syntax,
      limits: resolveParserLimits(limits),
      maximumPendingBlockLength,
    });
  }

  public append(text: string): MdxStreamSnapshot {
    this.assertOpen();

    return text.length === 0
      ? this.#session.current.snapshot
      : this.publish(this.#session.append(text));
  }

  public edit(edit: MdxEdit): MdxStreamSnapshot {
    this.assertOpen();
    const length = this.#session.current.snapshot.file.length;

    if (
      !Number.isSafeInteger(edit.start) ||
      !Number.isSafeInteger(edit.end) ||
      edit.start < 0 ||
      edit.end < edit.start ||
      edit.end > length
    ) {
      InputError.replacementRangeOutsideSource(edit.start, edit.end, length);
    }

    return this.publish(this.#session.edit(edit));
  }

  public snapshot(): MdxStreamSnapshot | MdxStreamCompletion {
    return this.#completion ?? this.#session.current.snapshot;
  }

  /**
   * Finishes the document strictly. Success is terminal; after a failure the
   * stream stays open, so an edit can repair it.
   */
  public complete(): MdxStreamCompletion {
    if (this.#completion !== undefined) {
      return this.#completion;
    }

    const completion = this.#session.complete();

    if (completion.kind === "ok") {
      this.#completion = completion;
    }

    return completion;
  }

  /** Calls `listener` after every change with what changed since the previous snapshot. */
  public subscribe(listener: (change: MdxStreamChange) => void): () => void {
    this.#listeners.add(listener);

    return () => this.#listeners.delete(listener);
  }

  private publish(change: MdxStreamChange): MdxStreamSnapshot {
    for (const listener of this.#listeners) {
      listener(change);
    }

    return change.snapshot;
  }

  private assertOpen(): void {
    if (this.#completion !== undefined) {
      InputError.streamCompleted();
    }
  }
}
