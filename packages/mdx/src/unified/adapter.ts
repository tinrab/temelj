import type { Preset, Plugin, Transformer } from "unified";

import { isFunction } from "@temelj/value";

import type { DocumentTransformContext, HtmlTransformContext } from "../plugin.ts";
import type { UnifiedAttach } from "./runtime.ts";

import { DocumentTransformPlugin, HtmlTransformPlugin } from "../plugin.ts";
import { runRehypePlugin, runRemarkPlugin } from "./runtime.ts";

type UnifiedNode = Parameters<Transformer>[0];

export type UnifiedAttacher<
  TParameters extends unknown[] = [],
  TInput extends UnifiedNode = UnifiedNode,
  TOutput extends UnifiedNode = TInput,
> = Plugin<TParameters, TInput, TOutput>;

export class RemarkPluginAdapter<
  TParameters extends unknown[] = [],
  TInput extends UnifiedNode = UnifiedNode,
  TOutput extends UnifiedNode = TInput,
> extends DocumentTransformPlugin {
  public readonly name: string;
  readonly #attach: UnifiedAttach;

  public constructor(preset: Preset);
  public constructor(
    plugin: UnifiedAttacher<TParameters, TInput, TOutput>,
    ...parameters: TParameters
  );
  public constructor(
    plugin: UnifiedAttacher<TParameters, TInput, TOutput> | Preset,
    ...parameters: TParameters
  ) {
    super();
    this.#attach = createAttach(plugin, parameters);
    this.name = `unified:remark:${pluginName(plugin)}`;
  }

  public transform(context: DocumentTransformContext) {
    return runRemarkPlugin(context, this.#attach);
  }
}

export class RehypePluginAdapter<
  TParameters extends unknown[] = [],
  TInput extends UnifiedNode = UnifiedNode,
  TOutput extends UnifiedNode = TInput,
> extends HtmlTransformPlugin {
  public readonly name: string;
  readonly #attach: UnifiedAttach;

  public constructor(preset: Preset);
  public constructor(
    plugin: UnifiedAttacher<TParameters, TInput, TOutput>,
    ...parameters: TParameters
  );
  public constructor(
    plugin: UnifiedAttacher<TParameters, TInput, TOutput> | Preset,
    ...parameters: TParameters
  ) {
    super();
    this.#attach = createAttach(plugin, parameters);
    this.name = `unified:rehype:${pluginName(plugin)}`;
  }

  public transform(context: HtmlTransformContext) {
    return runRehypePlugin(context, this.#attach);
  }
}

function createAttach<
  TParameters extends unknown[],
  TInput extends UnifiedNode,
  TOutput extends UnifiedNode,
>(
  plugin: UnifiedAttacher<TParameters, TInput, TOutput> | Preset,
  parameters: TParameters,
): UnifiedAttach {
  if (isPreset(plugin)) {
    if (parameters.length !== 0) {
      throw new TypeError("Unified presets do not accept plugin parameters");
    }

    return (processor) => processor.use(plugin);
  }

  return (processor) => {
    processor.use(plugin, ...parameters);
  };
}

function isPreset<
  TParameters extends unknown[],
  TInput extends UnifiedNode,
  TOutput extends UnifiedNode,
>(value: UnifiedAttacher<TParameters, TInput, TOutput> | Preset): value is Preset {
  return !isFunction(value);
}

function pluginName(plugin: Function | Preset): string {
  return isFunction(plugin) && plugin.name.length > 0 ? plugin.name : "preset";
}
