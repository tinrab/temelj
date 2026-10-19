import type { TemplateDelegate, HelperOptions } from "handlebars";

import type { Registry } from "./registry";

export function registerSwitchHelpers(registry: Registry): void {
  const switchStack: { switchMatch: boolean; switchValue: unknown }[] = [];
  registry.registerHelper(
    "switch",
    function (this: Parameters<TemplateDelegate>[0], value, options: HelperOptions): string {
      switchStack.push({
        switchMatch: false,
        switchValue: value,
      });

      try {
        return options.fn(this);
      } finally {
        switchStack.pop();
      }
    },
  );
  registry.registerHelper("case", function (this: Parameters<TemplateDelegate>[0], ...args):
    | string
    | undefined {
    const options = args.pop();
    const caseValues = args;
    const stack = switchStack?.at(-1);

    if (stack !== undefined) {
      if (stack.switchMatch || !caseValues.includes(stack.switchValue)) {
        return "";
      }

      stack.switchMatch = true;

      return options.fn(this);
    }
  });
  registry.registerHelper(
    "default",
    function (this: Parameters<TemplateDelegate>[0], options: HelperOptions): string | undefined {
      const stack = switchStack?.at(-1);

      if (!stack?.switchMatch) {
        return options.fn(this);
      }
    },
  );
}
