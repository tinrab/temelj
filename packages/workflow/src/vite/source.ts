/** Removes a URL or Vite query suffix from an ID. */
export function stripQuery(id: string): string {
  return id.split("?", 1)[0]!;
}

export type WorkflowSourceKind = "js" | "json" | "ts" | "tsx";

export function workflowSourceKindForId(id: string): WorkflowSourceKind {
  const cleanId = stripQuery(id);
  if (cleanId.endsWith(".tsx") || cleanId.endsWith(".jsx")) {
    return "tsx";
  }
  if (cleanId.endsWith(".js") || cleanId.endsWith(".mjs") || cleanId.endsWith(".cjs")) {
    return "js";
  }
  if (cleanId.endsWith(".json")) {
    return "json";
  }
  return "ts";
}
