import hbs from "handlebars";

import type { TemplateDelegate } from "handlebars";

export type { HelperDeclareSpec, HelperDelegate, Template } from "handlebars";

export type { TemplateDelegate };

export type PartialSpec = Record<string, TemplateDelegate>;

export class SafeString extends hbs.SafeString {}

export interface CompileOptions {
  data?: boolean;
  compat?: boolean;
  knownHelpers?: KnownHelpers;
  knownHelpersOnly?: boolean;
  noEscape?: boolean;
  strict?: boolean;
  assumeObjects?: boolean;
  preventIndent?: boolean;
  ignoreStandalone?: boolean;
  explicitPartialContext?: boolean;
}

export type KnownHelpers = {
  [name in BuiltinHelperName | CustomHelperName]: boolean;
};

export type BuiltinHelperName =
  | "helperMissing"
  | "blockHelperMissing"
  | "each"
  | "if"
  | "unless"
  | "with"
  | "log"
  | "lookup";

export type CustomHelperName = string;
