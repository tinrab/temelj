import { workflowPlugin } from "./vite/plugin.ts";

export { workflowPlugin, type WorkflowPluginOptions } from "./vite/plugin.ts";

/** Creates the webpack plugin that compiles workflow and step directives. */
export const workflow = workflowPlugin.webpack;
