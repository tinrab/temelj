import { err, ok } from "@temelj/result";

import type { EventHandler, EventMap, EventPattern, HandlerFailure, PubSub } from "./types";

interface Subscription {
  readonly pattern: string;
  readonly handler: EventHandler<any, any, any>;
  readonly once: boolean;
}

export function createPubSub<Events extends EventMap, E = unknown>(): PubSub<Events, E> {
  const subscriptions: Subscription[] = [];

  const remove = (pattern: string, handler: EventHandler<any, any, any>) => {
    const index = subscriptions.findIndex(
      (subscription) => subscription.pattern === pattern && subscription.handler === handler,
    );

    if (index >= 0) {
      subscriptions.splice(index, 1);
    }
  };

  const add = <Pattern extends EventPattern<Events>>(
    pattern: Pattern,
    handler: EventHandler<Events, Pattern, E>,
    once: boolean,
  ) => {
    const subscription: Subscription = { pattern, handler, once };
    subscriptions.push(subscription);

    return () => {
      const index = subscriptions.indexOf(subscription);
      if (index >= 0) {
        subscriptions.splice(index, 1);
      }
    };
  };

  return {
    on(pattern, handler) {
      return add(pattern, handler, false);
    },

    once(pattern, handler) {
      return add(pattern, handler, true);
    },

    off(pattern, handler) {
      remove(pattern, handler);
    },

    emit(event, ...args) {
      const payload = args[0];
      const matched = subscriptions.filter((subscription) => matches(subscription.pattern, event));
      const failures: HandlerFailure<E, typeof event>[] = [];

      for (let index = 0; index < matched.length; index++) {
        const subscription = matched[index]!;

        try {
          const result = subscription.handler(payload, event);
          if (result?.kind === "error") {
            failures.push({
              event,
              pattern: subscription.pattern,
              error: result.error,
              index,
            });
          }
        } catch (error) {
          failures.push({
            event,
            pattern: subscription.pattern,
            error: error as E,
            index,
          });
        }

        if (subscription.once) {
          const subscriptionIndex = subscriptions.indexOf(subscription);
          if (subscriptionIndex >= 0) {
            subscriptions.splice(subscriptionIndex, 1);
          }
        }
      }

      if (failures.length > 0) {
        return err(failures);
      }

      return ok({ event, handlers: matched.length });
    },

    listeners(pattern?: EventPattern<Events>) {
      const matched =
        pattern === undefined
          ? subscriptions
          : subscriptions.filter((subscription) => subscription.pattern === pattern);

      return matched.map((subscription) => subscription.handler);
    },

    clear(pattern) {
      if (pattern === undefined) {
        subscriptions.splice(0);
        return;
      }

      for (let index = subscriptions.length - 1; index >= 0; index--) {
        if (subscriptions[index]!.pattern === pattern) {
          subscriptions.splice(index, 1);
        }
      }
    },

    listenerCount(pattern) {
      if (pattern === undefined) {
        return subscriptions.length;
      }

      return subscriptions.filter((subscription) => subscription.pattern === pattern).length;
    },
  };
}

function matches(pattern: string, event: string): boolean {
  if (pattern === "*") {
    return true;
  }

  if (pattern.endsWith("*")) {
    return event.startsWith(pattern.slice(0, -1));
  }

  return pattern === event;
}
