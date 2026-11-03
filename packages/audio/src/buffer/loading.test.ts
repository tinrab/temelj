import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createMockAudioBuffer,
  createMockAudioContext,
  createMockFacade,
} from "../../tests/audio.ts";
import { AudioLoadError } from "../errors.ts";
import {
  getAudioFormat,
  getAudioMimeType,
  loadAudio,
  loadAudioData,
  resolveAudioUrl,
  selectAudioSourceCandidates,
} from "./loading.ts";

function stubFetch(responses: Readonly<Record<string, number>>) {
  const fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
    const status = responses[String(input)] ?? 200;

    return new Response(new Uint8Array(4), { status });
  });

  vi.stubGlobal("fetch", fetch);

  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("URL and format helpers", () => {
  it("resolves relative sources against a base URL", () => {
    expect(resolveAudioUrl("kick.wav", "/samples")).toBe("/samples/kick.wav");
    expect(resolveAudioUrl("kick.wav", "/samples/")).toBe("/samples/kick.wav");
    expect(resolveAudioUrl("/kick.wav", "/samples")).toBe("/kick.wav");
    expect(resolveAudioUrl("blob:abc", "/samples")).toBe("blob:abc");
    expect(resolveAudioUrl("kick.wav", undefined)).toBe("kick.wav");
  });

  it("detects formats and MIME types", () => {
    expect(getAudioFormat("/a/b.MP3?x=1#t")).toBe("mp3");
    expect(getAudioFormat("data:audio/ogg;base64,AAAA")).toBe("ogg");
    expect(getAudioFormat("/no-extension")).toBeUndefined();
    expect(getAudioMimeType(".mp3")).toBe("audio/mpeg");
    expect(getAudioMimeType("audio/webm")).toBe("audio/webm");
    expect(getAudioMimeType("aiff")).toBe("audio/aiff");
  });
});

describe("selectAudioSourceCandidates", () => {
  it("keeps candidates whose format is supported", () => {
    const selected = selectAudioSourceCandidates(["a.ogg", { format: "mp3", src: "b" }, "c.wav"], {
      baseUrl: "/audio",
      formats: ["mp3", "wav"],
    });

    expect(selected.map((candidate) => candidate.src)).toEqual(["/audio/b", "/audio/c.wav"]);
  });

  it("merges fetch options with candidate headers taking precedence", () => {
    const [candidate] = selectAudioSourceCandidates(
      { fetch: { headers: { "x-token": "candidate" } }, src: "a.wav" },
      { fetch: { headers: { "x-app": "app", "x-token": "app" }, mode: "cors" } },
    );

    const headers = new Headers(candidate?.fetch?.headers);
    expect(candidate?.fetch?.mode).toBe("cors");
    expect(headers.get("x-app")).toBe("app");
    expect(headers.get("x-token")).toBe("candidate");
  });
});

describe("loading", () => {
  it("decodes buffers, typed arrays, and fetched URLs", async () => {
    const context = createMockAudioContext();
    const fetch = stubFetch({});

    await loadAudioData(context, new ArrayBuffer(8));
    await loadAudioData(context, new Uint8Array(6));
    await loadAudioData(createMockFacade(context), "/kick.wav");

    expect(context.decodeAudioData).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenCalledWith("/kick.wav", undefined);
  });

  it("returns AudioBuffer candidates without decoding", async () => {
    const context = createMockAudioContext();
    const buffer = createMockAudioBuffer();

    await expect(loadAudio(context, buffer)).resolves.toBe(buffer);
    expect(context.decodeAudioData).not.toHaveBeenCalled();
  });

  it("falls back to later candidates and aggregates failures", async () => {
    const context = createMockAudioContext();
    stubFetch({ "/a.wav": 404, "/b.wav": 500 });

    await expect(loadAudio(context, ["/a.wav", "/c.wav"])).resolves.toBeDefined();
    const failure = loadAudio(context, ["/a.wav", "/b.wav"]);
    await expect(failure).rejects.toThrow(AudioLoadError);
    await expect(failure).rejects.toMatchObject({
      cause: { errors: [expect.any(AudioLoadError), expect.any(AudioLoadError)] },
    });
  });

  it("rethrows the error of a single candidate", async () => {
    const context = createMockAudioContext();
    stubFetch({ "/a.wav": 404 });

    await expect(loadAudio(context, "/a.wav")).rejects.toThrow("HTTP 404");
    await expect(loadAudio(context, [])).rejects.toThrow("is empty");
    await expect(loadAudio(context, "a.ogg", { formats: ["mp3"] })).rejects.toThrow(
      "unsupported audio format",
    );
  });
});
