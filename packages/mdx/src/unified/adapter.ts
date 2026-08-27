import type { Preset, Processor as UnifiedProcessor } from "unified";

import type { DocumentTransformContext, HtmlTransformContext } from "../plugin.ts";
import type { UnifiedAttach } from "./runtime.ts";

import { DocumentTransformPlugin, HtmlTransformPlugin } from "../plugin.ts";
import { runRehypePlugin, runRemarkPlugin } from "./runtime.ts";

export type UnifiedAttacher<TParameters extends unknown[] = []> = (
  this: UnifiedProcessor,
  ...parameters: TParameters
) => unknown;

export class RemarkPluginAdapter<
  TParameters extends unknown[] = [],
> extends DocumentTransformPlugin {
  public readonly name: string;
  readonly #attach: UnifiedAttach;

  public constructor(preset: Preset);
  public constructor(plugin: UnifiedAttacher<TParameters>, ...parameters: TParameters);
  public constructor(plugin: UnifiedAttacher<TParameters> | Preset, ...parameters: TParameters) {
    super();
    this.#attach = createAttach(plugin, parameters);
    this.name = `unified:remark:${pluginName(plugin)}`;
  }

  public transform(context: DocumentTransformContext) {
    return runRemarkPlugin(context, this.#attach);
  }
}

export class RehypePluginAdapter<TParameters extends unknown[] = []> extends HtmlTransformPlugin {
  public readonly name: string;
  readonly #attach: UnifiedAttach;

  public constructor(preset: Preset);
  public constructor(plugin: UnifiedAttacher<TParameters>, ...parameters: TParameters);
  public constructor(plugin: UnifiedAttacher<TParameters> | Preset, ...parameters: TParameters) {
    super();
    this.#attach = createAttach(plugin, parameters);
    this.name = `unified:rehype:${pluginName(plugin)}`;
  }

  public transform(context: HtmlTransformContext) {
    return runRehypePlugin(context, this.#attach);
  }
}

function createAttach<TParameters extends unknown[]>(
  plugin: UnifiedAttacher<TParameters> | Preset,
  parameters: TParameters,
): UnifiedAttach {
  if (isPreset(plugin)) {
    if (parameters.length !== 0) {
      throw new TypeError("Unified presets do not accept plugin parameters");
    }
    return (processor) => processor.use(plugin);
  }
  return (processor) => {
    // eslint-disable-next-line typescript/unbound-method
    Reflect.apply(processor.use, processor, [plugin, ...parameters]);
  };
}

function isPreset<TParameters extends unknown[]>(
  value: UnifiedAttacher<TParameters> | Preset,
): value is Preset {
  return typeof value !== "function";
}

function pluginName(plugin: Function | Preset): string {
  return typeof plugin === "function" && plugin.name.length > 0 ? plugin.name : "preset";
}
