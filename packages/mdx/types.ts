import type { Element, Node } from "hast";
import type { CompileResults, Processor } from "unified";

export type { Element as HastElement, Node as HastNode };

type MaybePromise<T> = T | Promise<T> | PromiseLike<T>;

type Plugin<
  TParameters extends unknown[] = [],
  TInput extends string | Node | undefined = Node,
  TOutput = TInput,
> = (
  this: Processor,
  ...parameters: TParameters
) => MaybePromise<
  TInput extends string ? TOutput extends Node | undefined ? undefined | void
    : never
    : TOutput extends CompileResults
      ? TInput extends Node | undefined ? undefined | void
      : never
    :
      | Transformer<
        TInput extends Node ? TInput : Node,
        TOutput extends Node ? TOutput : Node
      >
      | undefined
      | void
>;

export type PluginFactory<
  TParameters extends unknown[] = [],
  TInput extends string | Node | undefined = Node,
  TOutput = TInput,
> = (
  parameters?: TParameters,
) => MaybePromise<Plugin<TParameters, TInput, TOutput>>;
