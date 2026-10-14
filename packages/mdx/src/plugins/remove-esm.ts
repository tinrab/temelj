import type { DocumentNode } from "../model.ts";
import type { DocumentPlugin, DocumentPluginContext } from "../plugin.ts";

/** Removes authored imports and exports while retaining all renderable content. */
export class RemoveEsmPlugin implements DocumentPlugin {
  public readonly name = "remove-esm";

  public transform(context: DocumentPluginContext): DocumentNode {
    return context.rewrite({ esm: () => null });
  }
}
