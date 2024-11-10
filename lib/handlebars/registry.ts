import handlebars from "handlebars";

import { registerSwitchHelpers } from "~/handlebars/switch.ts";
import type {
  HelperDeclareSpec,
  HelperDelegate,
} from "~/handlebars/helpers/types.ts";

export class Registry {
  private readonly hbs: typeof Handlebars;

  constructor() {
    this.hbs = handlebars.create();
    registerSwitchHelpers(this);
  }

  public get partials(): Record<string, unknown> {
    return this.hbs.partials;
  }

  public static make(): Registry {
    return new Registry();
  }

  public compile(source: string): handlebars.TemplateDelegate {
    return this.hbs.compile(source);
  }

  public renderTemplate(source: string, data?: unknown): string {
    const compiledTemplate = this.hbs.compile(source);
    return compiledTemplate(data);
  }

  public registerHelper(name: string, helper: HelperDelegate): void {
    this.hbs.registerHelper(name, helper);
  }

  public registerHelpers(helpers: HelperDeclareSpec): void {
    for (const [name, helper] of Object.entries(helpers)) {
      this.registerHelper(name, helper);
    }
  }

  public registerPartial(name: string, template: handlebars.Template): void {
    this.hbs.registerPartial(name, template);
  }
}
