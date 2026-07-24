import { workflowPlugin } from "./vite/plugin.ts";

export { workflowPlugin, type WorkflowPluginOptions } from "./vite/plugin.ts";

/** Creates the esbuild plugin that compiles workflow and step directives. */
export const workflow = workflowPlugin.esbuild;
