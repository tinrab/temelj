import hbs from "handlebars";

import { registerSwitchHelpers } from "./switch.ts";
import type {
  HelperDeclareSpec,
  HelperDelegate,
  PartialSpec,
  Template,
  TemplateDelegate,
} from "./helpers/types.ts";
import { getHelpers } from "./helpers/all.ts";

export class Registry {
  public readonly handlebars: typeof Handlebars;

  constructor() {
    this.handlebars = hbs.create();
    registerSwitchHelpers(this);
  }

  public includeAllHelpers(): Registry {
    this.registerHelpers(getHelpers(this));
    return this;
  }

  public compile(source: string, options?: CompileOptions): TemplateDelegate {
    return this.handlebars.compile(source, options);
  }

  public render(
    source: string,
    data?: unknown,
    options?: CompileOptions,
  ): string {
    const compiledTemplate = this.compile(source, options);
    return compiledTemplate(data);
  }

  public registerHelper(name: string, helper: HelperDelegate): void {
    this.handlebars.registerHelper(name, helper);
  }

  public registerHelpers(helpers: HelperDeclareSpec): void {
    for (const [name, helper] of Object.entries(helpers)) {
      this.registerHelper(name, helper);
    }
  }

  public registerPartial(name: string, template: Template): void {
    this.handlebars.registerPartial(name, template);
  }

  public get partials(): PartialSpec {
    return this.handlebars.partials;
  }
}
