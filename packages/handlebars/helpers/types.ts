import type { TemplateDelegate } from "handlebars";

export type { HelperDeclareSpec, HelperDelegate, Template } from "handlebars";

export type { TemplateDelegate };

export type PartialSpec = Record<string, TemplateDelegate>;
