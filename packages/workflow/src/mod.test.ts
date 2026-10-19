import { describe, expect, expectTypeOf, test } from "vitest";

import type * as Root from "./mod.ts";

import * as root from "./mod.ts";

describe("root entry point", () => {
  test("exports the public runtime API only", () => {
    expect(Object.keys(root).sort()).toMatchSnapshot();
  });

  test("does not export internal types", () => {
    // @ts-expect-error Internal type; the root entry point does not export it.
    expectTypeOf<Root.CreateWorkflowWorkerOptions>().not.toBeNever();
    // @ts-expect-error Internal type; the root entry point does not export it.
    expectTypeOf<Root.CursorKeyPart>().not.toBeNever();
    // @ts-expect-error Internal type; the root entry point does not export it.
    expectTypeOf<Root.CursorPayload>().not.toBeNever();
    // @ts-expect-error Internal type; the root entry point does not export it.
    expectTypeOf<Root.EventDescriptor>().not.toBeNever();
    // @ts-expect-error Internal type; the root entry point does not export it.
    expectTypeOf<Root.EventFieldName>().not.toBeNever();
    // @ts-expect-error Internal type; the root entry point does not export it.
    expectTypeOf<Root.HandleOperations>().not.toBeNever();
    // @ts-expect-error Internal type; the root entry point does not export it.
    expectTypeOf<Root.ObservationEmitter>().not.toBeNever();
    // @ts-expect-error Internal type; the root entry point does not export it.
    expectTypeOf<Root.Registry>().not.toBeNever();
    // @ts-expect-error Internal type; the root entry point does not export it.
    expectTypeOf<Root.StepIdentity>().not.toBeNever();
    // @ts-expect-error Internal type; the root entry point does not export it.
    expectTypeOf<Root.StreamUpdateBase>().not.toBeNever();
    // @ts-expect-error Internal type; the root entry point does not export it.
    expectTypeOf<Root.TimelineClassification>().not.toBeNever();
    // @ts-expect-error Internal type; the root entry point does not export it.
    expectTypeOf<Root.ValueIssue>().not.toBeNever();
    // @ts-expect-error Internal type; the root entry point does not export it.
    expectTypeOf<Root.WorkflowHandle>().not.toBeNever();
  });
});
