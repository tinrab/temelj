import { describe, expect, test } from "vitest";

import { extractOptionsFromHtml } from "./scrape.ts";

describe("FFmpeg documentation extraction", () => {
  test("reads typed options, nested text, and possible values", () => {
    const options = extractOptionsFromHtml(
      "ffmpeg.html",
      `
      <div class="page-content inset">
        <h2>Video options</h2>
        <dl>
          <dt><samp>quality float</samp></dt>
          <dd>
            <p>Set <code>quality</code>. Default value is 23. Range is between 0 and 51.</p>
            <dl><dt>low</dt><dd>Small output</dd><dt>high</dt><dd>Large output</dd></dl>
          </dd>
        </dl>
      </div>
    `,
    );

    expect(options).toEqual([
      {
        name: "quality",
        aliases: [],
        type: "float",
        categories: [],
        arguments: "",
        description: "Set quality . Default value is 23. Range is between 0 and 51.",
        default: "23",
        range: { min: "0", max: "51." },
        possible_values: [
          { value: "low", description: "Small output" },
          { value: "high", description: "Large output" },
        ],
        page: "ffmpeg",
        page_type: "tool",
        section: "Video options",
      },
    ]);
  });

  test("returns no options when the documentation body is absent", () => {
    expect(extractOptionsFromHtml("ffmpeg.html", "<nav><dl><dt>menu</dt></dl></nav>")).toEqual([]);
  });
});
