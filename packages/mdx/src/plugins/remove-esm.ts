import type { DocumentTransformContext } from "../plugin.ts";

import { DocumentNode, EsmNode } from "../model.ts";
import { DocumentTransformPlugin } from "../plugin.ts";

/** Removes authored imports and exports while retaining all renderable content. */
export class RemoveEsmPlugin extends DocumentTransformPlugin {
  public readonly name = "remove-esm";

  public transform(context: DocumentTransformContext): DocumentNode {
    return context.document.with({
      children: context.document.children.filter((child) => !(child instanceof EsmNode)),
    });
  }
}
