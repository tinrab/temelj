import type { HtmlFormatOptions } from "./html-format.ts";
import type { MdxStream } from "./stream.ts";

import { CachedHtmlFormatter } from "./html-format.ts";
import { lowerHtml } from "./html-lower.ts";
import { previewDocument } from "./stream-events.ts";

/** Serializes one stream, reusing HTML for its immutable nodes across appends and edits. */
export class HtmlStreamRenderer {
  readonly #stream: MdxStream;
  readonly #formatter: CachedHtmlFormatter;
  #previous: Readonly<{ snapshot: ReturnType<MdxStream["snapshot"]>; html: string }> | undefined;

  /** Formatting options are captured at construction. */
  public constructor(stream: MdxStream, options: HtmlFormatOptions = {}) {
    this.#stream = stream;
    this.#formatter = new CachedHtmlFormatter({ ...options });
  }

  /** The current preview, or the strict document after successful completion. */
  public render(): string {
    const snapshot = this.#stream.snapshot();
    const previous = this.#previous;

    if (previous !== undefined && previous.snapshot === snapshot) {
      return previous.html;
    }

    const tree =
      snapshot.kind === "preview" ? previewDocument(snapshot) : lowerHtml(snapshot.document);

    const html = this.#formatter.format(tree);
    this.#previous = { snapshot, html };

    return html;
  }
}
