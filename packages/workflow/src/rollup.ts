import { workflowPlugin } from "./vite/plugin.ts";

export { workflowPlugin, type WorkflowPluginOptions } from "./vite/plugin.ts";

/** Creates the Rollup plugin that compiles workflow and step directives. */
export const workflow = workflowPlugin.rollup;
