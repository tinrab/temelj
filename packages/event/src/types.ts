import type { Result } from "@temelj/result";

export type EventMap = object;
export type EventKey<Events extends EventMap> = Extract<keyof Events, string>;

export type EventNamespace<Key extends string> = Key extends `${infer Namespace}:${infer Rest}`
  ? Namespace | `${Namespace}:${EventNamespace<Rest>}`
  : never;

export type EventPattern<Events extends EventMap> =
  | EventKey<Events>
  | "*"
  | `${EventNamespace<EventKey<Events>>}:*`;

export type PatternEvents<
  Events extends EventMap,
  Pattern extends EventPattern<Events>,
> = Pattern extends "*"
  ? EventKey<Events>
  : Pattern extends `${infer Namespace}:*`
    ? Extract<EventKey<Events>, `${Namespace}:${string}`>
    : Extract<EventKey<Events>, Pattern>;

export type PatternPayload<
  Events extends EventMap,
  Pattern extends EventPattern<Events>,
> = Events[PatternEvents<Events, Pattern>];

export type HandlerReturn<E = unknown> = void | Result<unknown, E>;

export type EventHandler<
  Events extends EventMap,
  Pattern extends EventPattern<Events>,
  E = unknown,
> = (
  payload: PatternPayload<Events, Pattern>,
  event: PatternEvents<Events, Pattern>,
) => HandlerReturn<E>;

export type Unsubscribe = () => void;

export type EmitPayloadArgs<T> = [T] extends [void] ? [] | [payload: T] : [payload: T];

export interface EmitReport<Event extends string = string> {
  readonly event: Event;
  readonly handlers: number;
}

export interface HandlerFailure<E = unknown, Event extends string = string> {
  readonly event: Event;
  readonly pattern: string;
  readonly error: E;
  readonly index: number;
}

export interface PubSub<Events extends EventMap, E = unknown> {
  on<Pattern extends EventPattern<Events>>(
    pattern: Pattern,
    handler: EventHandler<Events, Pattern, E>,
  ): Unsubscribe;

  once<Pattern extends EventPattern<Events>>(
    pattern: Pattern,
    handler: EventHandler<Events, Pattern, E>,
  ): Unsubscribe;

  off<Pattern extends EventPattern<Events>>(
    pattern: Pattern,
    handler: EventHandler<Events, Pattern, E>,
  ): void;

  emit<Key extends EventKey<Events>>(
    event: Key,
    ...args: EmitPayloadArgs<Events[Key]>
  ): Result<EmitReport<Key>, HandlerFailure<E, Key>[]>;

  listeners(): readonly EventHandler<Events, EventPattern<Events>, E>[];
  listeners<Pattern extends EventPattern<Events>>(
    pattern: Pattern,
  ): readonly EventHandler<Events, Pattern, E>[];

  clear(pattern?: EventPattern<Events>): void;
  listenerCount(pattern?: EventPattern<Events>): number;
}
