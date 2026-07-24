import { workflow as workflowRolldownPlugin } from "@temelj/workflow/rolldown";
import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";

const rootUrl = new URL("../", import.meta.url);
const outdirUrl = new URL("./dist/", rootUrl);

await rm(outdirUrl, { recursive: true, force: true });
await mkdir(outdirUrl, { recursive: true });
const bundle = await rolldown({
  input: fileURLToPath(new URL("./src/main.ts", rootUrl)),
  external: (id) =>
    id.startsWith("node:") ||
    id.startsWith("@opentelemetry/") ||
    id === "@temelj/workflow" ||
    id.startsWith("@temelj/workflow/"),
  plugins: [workflowRolldownPlugin({ root: fileURLToPath(rootUrl) })],
});
await bundle.write({
  file: fileURLToPath(new URL("./main.mjs", outdirUrl)),
  format: "esm",
});
await bundle.close();
