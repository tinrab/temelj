import type { Registry } from "~/handlebars/registry.ts";

export function registerSwitchHelpers(registry: Registry): void {
  const hbs: Registry & {
    switchStack?: {
      switchMatch: boolean;
      switchValue: unknown;
    }[];
  } = registry;
  hbs.switchStack = [];

  hbs.switchStack = [];
  hbs.registerHelper(
    "switch",
    function (value, options) {
      if (hbs.switchStack === undefined) {
        return;
      }
      hbs.switchStack.push({
        switchMatch: false,
        switchValue: value,
      });
      // @ts-ignore handlebars missing types
      const rendered = options.fn(this);
      hbs.switchStack.pop();
      return rendered;
    },
  );
  hbs.registerHelper("case", function (...args) {
    const options = args.pop();
    const caseValues = args;
    const stack = hbs.switchStack?.at(-1);
    if (stack !== undefined) {
      if (stack.switchMatch || !caseValues.includes(stack.switchValue)) {
        return "";
      }
      stack.switchMatch = true;
      // @ts-ignore handlebars missing types
      return options.fn(this);
    }
  });
  hbs.registerHelper("default", function (options) {
    const stack = hbs.switchStack?.at(-1);
    if (!stack?.switchMatch) {
      // @ts-ignore handlebars missing types
      return options.fn(this);
    }
  });
}
