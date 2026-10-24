// Installs Temporal when the runtime lacks it, before any module uses it.
import "temporal-polyfill/global";
import { workflowPlugin } from "./compiler/plugin.ts";

export { workflowPlugin, type PluginOptions } from "./compiler/plugin.ts";

/** Creates the Rspack plugin that compiles workflow and step directives. */
export const workflow: typeof workflowPlugin.rspack = workflowPlugin.rspack;
