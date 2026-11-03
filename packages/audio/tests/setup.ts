import { MockAudioBuffer } from "./audio.ts";

// Node has no Web Audio; buffer helpers allocate with `new AudioBuffer(…)`.
Object.defineProperty(globalThis, "AudioBuffer", {
  configurable: true,
  value: MockAudioBuffer,
  writable: true,
});
