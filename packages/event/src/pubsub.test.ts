import { err, isErr, isOk, ok } from "@temelj/result";
import { describe, expect, expectTypeOf, it } from "vitest";

import type { EventHandler } from "./types";

import { createPubSub } from "./pubsub";

type AppEvents = {
  "system:ready": void;
  "user:login": { userId: string };
  "user:logout": void;
  "billing:invoice:paid": { invoiceId: string };
  "order:created": { orderId: string };
};

interface InterfaceEvents {
  "user:login": { userId: string };
  "user:logout": void;
}

describe("createPubSub", () => {
  it("emits typed payloads to exact subscriptions", () => {
    const bus = createPubSub<AppEvents>();
    const received: string[] = [];

    bus.on("user:login", (payload) => {
      received.push(payload.userId);
    });

    const result = bus.emit("user:login", { userId: "user_1" });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) {
      throw new Error("expected emit to succeed");
    }
    expect(result.value).toEqual({ event: "user:login", handlers: 1 });
    expect(received).toEqual(["user_1"]);
  });

  it("allows void events to be emitted without a payload", () => {
    const bus = createPubSub<AppEvents>();
    let count = 0;

    bus.on("user:logout", () => {
      count += 1;
    });

    bus.emit("user:logout");

    expect(count).toBe(1);
  });

  it("routes namespace wildcard subscriptions", () => {
    const bus = createPubSub<AppEvents>();
    const received: string[] = [];

    bus.on("user:*", (_payload, event) => {
      received.push(event);
    });

    bus.emit("user:login", { userId: "user_1" });
    bus.emit("user:logout");
    bus.emit("order:created", { orderId: "order_1" });

    expect(received).toEqual(["user:login", "user:logout"]);
  });

  it("routes nested namespace wildcard subscriptions", () => {
    const bus = createPubSub<AppEvents>();
    const received: string[] = [];

    bus.on("billing:invoice:*", (payload, event) => {
      expectTypeOf(payload).toEqualTypeOf<{ invoiceId: string }>();
      expectTypeOf(event).toEqualTypeOf<"billing:invoice:paid">();
      received.push(payload.invoiceId);
    });

    bus.emit("billing:invoice:paid", { invoiceId: "invoice_1" });
    bus.emit("order:created", { orderId: "order_1" });

    expect(received).toEqual(["invoice_1"]);
  });

  it("routes global wildcard subscriptions", () => {
    const bus = createPubSub<AppEvents>();
    const received: string[] = [];

    bus.on("*", (_payload, event) => {
      received.push(event);
    });

    bus.emit("system:ready");
    bus.emit("order:created", { orderId: "order_1" });

    expect(received).toEqual(["system:ready", "order:created"]);
  });

  it("returns handler failures as a result error and continues dispatching", () => {
    const bus = createPubSub<AppEvents, string>();
    const received: string[] = [];

    bus.on("user:login", () => err("invalid session"));
    bus.on("user:login", (payload) => {
      received.push(payload.userId);
      return ok(undefined);
    });

    const result = bus.emit("user:login", { userId: "user_1" });

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) {
      throw new Error("expected emit to fail");
    }
    expect(result.error).toEqual([
      {
        event: "user:login",
        pattern: "user:login",
        error: "invalid session",
        index: 0,
      },
    ]);
    expect(received).toEqual(["user_1"]);
  });

  it("captures thrown handler errors", () => {
    const bus = createPubSub<AppEvents>();
    const thrown = new Error("boom");

    bus.on("system:ready", () => {
      throw thrown;
    });

    const result = bus.emit("system:ready");

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) {
      throw new Error("expected emit to fail");
    }
    expect(result.error[0]?.error).toBe(thrown);
  });

  it("supports unsubscribe, off, once, clear, and listener counts", () => {
    const bus = createPubSub<AppEvents>();
    let count = 0;
    const handler = () => {
      count += 1;
    };

    const unsubscribe = bus.on("system:ready", handler);
    expect(bus.listenerCount()).toBe(1);
    expect(bus.listenerCount("system:ready")).toBe(1);

    unsubscribe();
    expect(bus.listenerCount()).toBe(0);

    bus.on("system:ready", handler);
    bus.off("system:ready", handler);
    expect(bus.listenerCount()).toBe(0);

    bus.once("system:ready", handler);
    bus.emit("system:ready");
    bus.emit("system:ready");
    expect(count).toBe(1);
    expect(bus.listenerCount()).toBe(0);

    bus.on("system:ready", handler);
    bus.on("*", handler);
    bus.clear("*");
    expect(bus.listenerCount()).toBe(1);
    bus.clear();
    expect(bus.listenerCount()).toBe(0);
  });

  it("returns listener snapshots", () => {
    const bus = createPubSub<AppEvents>();
    const systemHandler = () => {};
    const loginHandler = (payload: { userId: string }) => {
      expectTypeOf(payload).toEqualTypeOf<{ userId: string }>();
    };
    const wildcardHandler = (_payload: { userId: string } | void) => {};

    const unsubscribe = bus.on("system:ready", systemHandler);
    bus.on("user:login", loginHandler);
    bus.on("user:*", wildcardHandler);

    const loginListeners = bus.listeners("user:login");
    expectTypeOf(loginListeners).toEqualTypeOf<readonly EventHandler<AppEvents, "user:login">[]>();
    expect(loginListeners).toEqual([loginHandler]);

    expect(bus.listeners()).toEqual([systemHandler, loginHandler, wildcardHandler]);
    expect(bus.listeners("user:*")).toEqual([wildcardHandler]);

    unsubscribe();
    expect(loginListeners).toEqual([loginHandler]);
    expect(bus.listeners()).toEqual([loginHandler, wildcardHandler]);
  });

  it("preserves payload and event types for exact and wildcard handlers", () => {
    const bus = createPubSub<AppEvents>();

    bus.on("user:login", (payload, event) => {
      expectTypeOf(payload).toEqualTypeOf<{ userId: string }>();
      expectTypeOf(event).toEqualTypeOf<"user:login">();
    });

    bus.on("user:*", (payload, event) => {
      expectTypeOf(payload).toEqualTypeOf<{ userId: string } | void>();
      expectTypeOf(event).toEqualTypeOf<"user:login" | "user:logout">();
    });

    bus.on("*", (payload, event) => {
      expectTypeOf(payload).toEqualTypeOf<
        void | { userId: string } | { invoiceId: string } | { orderId: string }
      >();
      expectTypeOf(event).toEqualTypeOf<keyof AppEvents>();
    });

    bus.emit("user:login", { userId: "user_1" });
    bus.emit("user:logout");

    // @ts-expect-error payload is required for non-void events
    bus.emit("user:login");
    // @ts-expect-error payload must match the event
    bus.emit("user:login", { orderId: "order_1" });
    // @ts-expect-error unknown event names are rejected
    bus.emit("user:created", { userId: "user_1" });
    // @ts-expect-error unknown namespaces are rejected
    bus.on("unknown:*", () => {});
  });

  it("accepts interface-shaped event maps", () => {
    const bus = createPubSub<InterfaceEvents>();

    bus.on("user:login", (payload, event) => {
      expectTypeOf(payload).toEqualTypeOf<{ userId: string }>();
      expectTypeOf(event).toEqualTypeOf<"user:login">();
    });

    bus.on("user:*", (payload, event) => {
      expectTypeOf(payload).toEqualTypeOf<void | { userId: string }>();
      expectTypeOf(event).toEqualTypeOf<"user:login" | "user:logout">();
    });

    bus.emit("user:login", { userId: "user_1" });
    bus.emit("user:logout");

    // @ts-expect-error interface event maps still reject unknown events
    bus.emit("user:created", { userId: "user_1" });
  });
});
