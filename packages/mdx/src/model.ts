import type { HeadingDepth } from "./heading.ts";
import type { FrontmatterFormat, MathFormat, SyntaxOptions } from "./syntax-options.ts";

import { InputError } from "./errors.ts";
import { format } from "./format.ts";
import { normalizeIdentifier } from "./identifier.ts";
import { SourceFile } from "./source.ts";
import { selectTree } from "./tree.ts";
import { applyOptionalUpdate, sameSequence } from "./utility.ts";

export { SourceFile, type SourceLocation } from "./source.ts";

export interface SourceSpan {
  readonly file: SourceFile;
  readonly start: number;
  readonly end: number;
}

export interface FormatOptions {
  readonly bullet?: "*" | "+" | "-";
  readonly bulletOrdered?: "." | ")";
  readonly closeAtx?: boolean;
  readonly emphasis?: "*" | "_";
  readonly fence?: "`" | "~";
  readonly footnoteFirstLineBlank?: boolean;
  readonly incrementListMarker?: boolean;
  readonly listItemIndent?: "mixed" | "one" | "tab";
  readonly quote?: '"' | "'";
  readonly rule?: "*" | "-" | "_";
  readonly ruleRepetition?: number;
  readonly ruleSpaces?: boolean;
  readonly strong?: "*" | "_";
  readonly syntax?: SyntaxOptions;
  readonly tightDefinitions?: boolean;
  readonly tableCellPadding?: boolean;
  readonly tablePipeAlign?: boolean;
  readonly tableStringLength?: (value: string) => number;
}

export abstract class SyntaxNode<TKind extends string> {
  public abstract readonly kind: TKind;
  public abstract readonly children: readonly MdxNode[];
  public readonly origin: Readonly<SourceSpan> | undefined;

  protected constructor(origin?: SourceSpan) {
    this.origin = origin === undefined ? undefined : Object.freeze({ ...origin });
  }

  public abstract toString(): string;

  public toSource(this: MdxNode, options?: FormatOptions): string {
    return format(this, options);
  }

  public sourceText(): string | undefined {
    return this.origin?.file.text.slice(this.origin.start, this.origin.end);
  }
}

abstract class ParentNode<TKind extends string, TChild extends MdxNode> extends SyntaxNode<TKind> {
  public readonly children: readonly TChild[];

  protected constructor(children: readonly TChild[], origin?: SourceSpan) {
    super(origin);
    this.children = Object.freeze([...children]);
  }

  public toString(): string {
    return this.children.map((child) => child.toString()).join("");
  }
}

export abstract class BlockNode<
  TKind extends string,
  TChild extends MdxNode = MdxNode,
> extends ParentNode<TKind, TChild> {}
export abstract class InlineNode<
  TKind extends string,
  TChild extends MdxNode = MdxNode,
> extends ParentNode<TKind, TChild> {}

export class TextNode extends InlineNode<"text", never> {
  public readonly kind = "text";
  public readonly value: string;
  public constructor(value: string, origin?: SourceSpan) {
    super([], origin);
    this.value = value;
    Object.freeze(this);
  }
  public toString(): string {
    return this.value;
  }
  public with(changes: Readonly<{ value?: string }>): TextNode {
    return changes.value === undefined || changes.value === this.value
      ? this
      : new TextNode(changes.value, this.origin);
  }
}

export class EmphasisNode extends InlineNode<"emphasis", PhrasingContent> {
  public readonly kind = "emphasis";
  public constructor(children: readonly PhrasingContent[], origin?: SourceSpan) {
    super(children, origin);
    Object.freeze(this);
  }
  public with(changes: Readonly<{ children?: readonly PhrasingContent[] }>): EmphasisNode {
    return changes.children === undefined || sameSequence(this.children, changes.children)
      ? this
      : new EmphasisNode(changes.children, this.origin);
  }
}

export class StrongNode extends InlineNode<"strong", PhrasingContent> {
  public readonly kind = "strong";
  public constructor(children: readonly PhrasingContent[], origin?: SourceSpan) {
    super(children, origin);
    Object.freeze(this);
  }
  public with(changes: Readonly<{ children?: readonly PhrasingContent[] }>): StrongNode {
    return changes.children === undefined || sameSequence(this.children, changes.children)
      ? this
      : new StrongNode(changes.children, this.origin);
  }
}

export class DeleteNode extends InlineNode<"delete", PhrasingContent> {
  public readonly kind = "delete";
  public constructor(children: readonly PhrasingContent[], origin?: SourceSpan) {
    super(children, origin);
    Object.freeze(this);
  }
  public with(changes: Readonly<{ children?: readonly PhrasingContent[] }>): DeleteNode {
    return changes.children === undefined || sameSequence(this.children, changes.children)
      ? this
      : new DeleteNode(changes.children, this.origin);
  }
}

export class InlineCodeNode extends InlineNode<"inlineCode", never> {
  public readonly kind = "inlineCode";
  public readonly value: string;
  public constructor(value: string, origin?: SourceSpan) {
    super([], origin);
    this.value = value;
    Object.freeze(this);
  }
  public toString(): string {
    return this.value;
  }
  public with(changes: Readonly<{ value?: string }>): InlineCodeNode {
    return changes.value === undefined || changes.value === this.value
      ? this
      : new InlineCodeNode(changes.value, this.origin);
  }
}

export class LinkNode extends InlineNode<"link", PhrasingContent> {
  public readonly kind = "link";
  public readonly url: string;
  public readonly title?: string;
  public constructor(
    url: string,
    children: readonly PhrasingContent[],
    options: Readonly<{ title?: string; origin?: SourceSpan }> = {},
  ) {
    super(children, options.origin);
    this.url = url;
    this.title = options.title;
    Object.freeze(this);
  }
  public with(
    changes: Readonly<{
      url?: string;
      title?: string | null;
      children?: readonly PhrasingContent[];
    }>,
  ): LinkNode {
    const url = changes.url ?? this.url;
    const title = applyOptionalUpdate(this.title, changes.title);
    const children = changes.children ?? this.children;
    return url === this.url && title === this.title && sameSequence(this.children, children)
      ? this
      : new LinkNode(url, children, { title, origin: this.origin });
  }
}

export class ImageNode extends InlineNode<"image", never> {
  public readonly kind = "image";
  public readonly url: string;
  public readonly alt: string;
  public readonly title?: string;
  public constructor(
    url: string,
    alt: string,
    options: Readonly<{ title?: string; origin?: SourceSpan }> = {},
  ) {
    super([], options.origin);
    this.url = url;
    this.alt = alt;
    this.title = options.title;
    Object.freeze(this);
  }
  public toString(): string {
    return this.alt;
  }
  public with(changes: Readonly<{ url?: string; alt?: string; title?: string | null }>): ImageNode {
    const url = changes.url ?? this.url;
    const alt = changes.alt ?? this.alt;
    const title = applyOptionalUpdate(this.title, changes.title);
    return url === this.url && alt === this.alt && title === this.title
      ? this
      : new ImageNode(url, alt, { title, origin: this.origin });
  }
}

export class FootnoteReferenceNode extends InlineNode<"footnoteReference", never> {
  public readonly identifier: string;
  public readonly kind = "footnoteReference";
  public readonly label: string;
  public constructor(
    identifier: string,
    options: Readonly<{ label?: string; origin?: SourceSpan }> = {},
  ) {
    super([], options.origin);
    this.identifier = normalizeIdentifier(identifier);
    this.label = options.label ?? identifier;
    Object.freeze(this);
  }
  public with(changes: Readonly<{ identifier?: string; label?: string }>): FootnoteReferenceNode {
    const identifier = normalizeIdentifier(changes.identifier ?? this.identifier);
    const label = changes.label ?? this.label;
    return identifier === this.identifier && label === this.label
      ? this
      : new FootnoteReferenceNode(identifier, { label, origin: this.origin });
  }
}

/** A reference destination, retained for later reference resolution. */
export class DefinitionNode extends BlockNode<"definition", never> {
  public readonly kind = "definition";
  public readonly identifier: string;
  public readonly url: string;
  public readonly title?: string;
  public constructor(
    identifier: string,
    url: string,
    options: Readonly<{ title?: string; origin?: SourceSpan }> = {},
  ) {
    super([], options.origin);
    this.identifier = normalizeIdentifier(identifier);
    this.url = url;
    this.title = options.title;
    Object.freeze(this);
  }
  public with(
    changes: Readonly<{ identifier?: string; url?: string; title?: string | null }>,
  ): DefinitionNode {
    const identifier = normalizeIdentifier(changes.identifier ?? this.identifier);
    const url = changes.url ?? this.url;
    const title = applyOptionalUpdate(this.title, changes.title);
    return identifier === this.identifier && url === this.url && title === this.title
      ? this
      : new DefinitionNode(identifier, url, { title, origin: this.origin });
  }
}

export class FootnoteDefinitionNode extends BlockNode<"footnoteDefinition", FlowContent> {
  public readonly identifier: string;
  public readonly kind = "footnoteDefinition";
  public readonly label: string;
  public constructor(
    identifier: string,
    children: readonly FlowContent[],
    options: Readonly<{ label?: string; origin?: SourceSpan }> = {},
  ) {
    super(children, options.origin);
    this.identifier = normalizeIdentifier(identifier);
    this.label = options.label ?? identifier;
    Object.freeze(this);
  }
  public with(
    changes: Readonly<{
      identifier?: string;
      label?: string;
      children?: readonly FlowContent[];
    }>,
  ): FootnoteDefinitionNode {
    const identifier = normalizeIdentifier(changes.identifier ?? this.identifier);
    const label = changes.label ?? this.label;
    const children = changes.children ?? this.children;
    return identifier === this.identifier &&
      label === this.label &&
      sameSequence(this.children, children)
      ? this
      : new FootnoteDefinitionNode(identifier, children, { label, origin: this.origin });
  }
}

export class FrontmatterNode extends BlockNode<"frontmatter", never> {
  public readonly data: FrontmatterObject | undefined;
  public readonly format: FrontmatterFormat;
  public readonly kind = "frontmatter";
  public readonly value: string;
  public readonly valueOrigin: SourceSpan;
  public constructor(
    format: FrontmatterFormat,
    value: string,
    options: Readonly<{
      data?: FrontmatterObject;
      origin?: SourceSpan;
      valueOrigin?: SourceSpan;
    }> = {},
  ) {
    super([], options.origin);
    this.format = format;
    this.value = value;
    this.valueOrigin = Object.freeze(
      options.valueOrigin ?? { file: new SourceFile(value), start: 0, end: value.length },
    );
    this.data = options.data;
    Object.freeze(this);
  }
  public with(changes: Readonly<{ value?: string; format?: FrontmatterFormat }>): FrontmatterNode {
    const value = changes.value ?? this.value;
    const format = changes.format ?? this.format;
    return value === this.value && format === this.format
      ? this
      : new FrontmatterNode(format, value, { origin: this.origin });
  }
}

export type FrontmatterValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | FrontmatterTemporal
  | readonly FrontmatterValue[]
  | FrontmatterObject;

export interface FrontmatterObject {
  readonly [key: string]: FrontmatterValue;
}

export type FrontmatterTemporalKind =
  | "offset-date-time"
  | "local-date-time"
  | "local-date"
  | "local-time";

export class FrontmatterTemporal {
  public readonly kind: FrontmatterTemporalKind;
  public readonly value: string;

  public constructor(kind: FrontmatterTemporalKind, value: string) {
    this.kind = kind;
    this.value = value;
    Object.freeze(this);
  }

  public toString(): string {
    return this.value;
  }
}

export class DirectiveAttribute {
  public readonly name: string;
  public readonly value: string;

  public constructor(name: string, value = "") {
    this.name = name;
    this.value = value;
    Object.freeze(this);
  }
}

export class DirectiveAttributes implements Iterable<DirectiveAttribute> {
  public readonly entries: readonly DirectiveAttribute[];

  public constructor(entries: readonly DirectiveAttribute[] = []) {
    const names = new Set<string>();
    for (const entry of entries) {
      if (names.has(entry.name)) {
        InputError.duplicateDirectiveAttribute(entry.name);
      }
      names.add(entry.name);
    }
    this.entries = Object.freeze([...entries]);
    Object.freeze(this);
  }

  public get size(): number {
    return this.entries.length;
  }

  public get(name: string): string | undefined {
    for (const entry of this.entries) {
      if (entry.name === name) {
        return entry.value;
      }
    }
    return undefined;
  }

  public has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  public set(name: string, value: string): DirectiveAttributes {
    const index = this.entries.findIndex((entry) => entry.name === name);
    if (index !== -1 && this.entries[index].value === value) {
      return this;
    }
    const entries = [...this.entries];
    const attribute = new DirectiveAttribute(name, value);
    if (index === -1) {
      entries.push(attribute);
    } else {
      entries.splice(index, 1, attribute);
    }
    return new DirectiveAttributes(entries);
  }

  public delete(name: string): DirectiveAttributes {
    return this.has(name)
      ? new DirectiveAttributes(this.entries.filter((entry) => entry.name !== name))
      : this;
  }

  public [Symbol.iterator](): Iterator<DirectiveAttribute> {
    return this.entries[Symbol.iterator]();
  }
}

function sameDirectiveAttributes(left: DirectiveAttributes, right: DirectiveAttributes): boolean {
  return (
    left === right ||
    (left.size === right.size &&
      left.entries.every((entry, index) => {
        const other = right.entries[index];
        return entry.name === other.name && entry.value === other.value;
      }))
  );
}

export class DirectiveLabelNode extends InlineNode<"directiveLabel", PhrasingContent> {
  public readonly kind = "directiveLabel";

  public constructor(children: readonly PhrasingContent[], origin?: SourceSpan) {
    super(children, origin);
    Object.freeze(this);
  }

  public with(changes: Readonly<{ children?: readonly PhrasingContent[] }>): DirectiveLabelNode {
    return changes.children === undefined || sameSequence(this.children, changes.children)
      ? this
      : new DirectiveLabelNode(changes.children, this.origin);
  }
}

export interface DirectiveOptions {
  readonly attributes?: DirectiveAttributes;
  readonly label?: DirectiveLabelNode;
  readonly origin?: SourceSpan;
}

export class TextDirectiveNode extends InlineNode<"textDirective", DirectiveLabelNode> {
  public readonly attributes: DirectiveAttributes;
  public readonly kind = "textDirective";
  public readonly label?: DirectiveLabelNode;
  public readonly name: string;

  public constructor(name: string, options: DirectiveOptions = {}) {
    super(options.label === undefined ? [] : [options.label], options.origin);
    this.name = name;
    this.label = options.label;
    this.attributes = options.attributes ?? new DirectiveAttributes();
    Object.freeze(this);
  }

  public toString(): string {
    return this.label?.toString() ?? "";
  }

  public with(
    changes: Readonly<{
      name?: string;
      label?: DirectiveLabelNode | null;
      attributes?: DirectiveAttributes;
    }>,
  ): TextDirectiveNode {
    const name = changes.name ?? this.name;
    const label = applyOptionalUpdate(this.label, changes.label);
    const attributes = changes.attributes ?? this.attributes;
    return name === this.name &&
      label === this.label &&
      sameDirectiveAttributes(attributes, this.attributes)
      ? this
      : new TextDirectiveNode(name, { label, attributes, origin: this.origin });
  }
}

export class LeafDirectiveNode extends BlockNode<"leafDirective", DirectiveLabelNode> {
  public readonly attributes: DirectiveAttributes;
  public readonly kind = "leafDirective";
  public readonly label?: DirectiveLabelNode;
  public readonly name: string;

  public constructor(name: string, options: DirectiveOptions = {}) {
    super(options.label === undefined ? [] : [options.label], options.origin);
    this.name = name;
    this.label = options.label;
    this.attributes = options.attributes ?? new DirectiveAttributes();
    Object.freeze(this);
  }

  public toString(): string {
    return this.label?.toString() ?? "";
  }

  public with(
    changes: Readonly<{
      name?: string;
      label?: DirectiveLabelNode | null;
      attributes?: DirectiveAttributes;
    }>,
  ): LeafDirectiveNode {
    const name = changes.name ?? this.name;
    const label = applyOptionalUpdate(this.label, changes.label);
    const attributes = changes.attributes ?? this.attributes;
    return name === this.name &&
      label === this.label &&
      sameDirectiveAttributes(attributes, this.attributes)
      ? this
      : new LeafDirectiveNode(name, { label, attributes, origin: this.origin });
  }
}

export class ContainerDirectiveNode extends BlockNode<
  "containerDirective",
  DirectiveLabelNode | FlowContent
> {
  public readonly attributes: DirectiveAttributes;
  public readonly body: readonly FlowContent[];
  public readonly kind = "containerDirective";
  public readonly label?: DirectiveLabelNode;
  public readonly name: string;

  public constructor(name: string, body: readonly FlowContent[], options: DirectiveOptions = {}) {
    super(options.label === undefined ? body : [options.label, ...body], options.origin);
    this.name = name;
    this.label = options.label;
    this.body = Object.freeze([...body]);
    this.attributes = options.attributes ?? new DirectiveAttributes();
    Object.freeze(this);
  }

  public toString(): string {
    return `${this.label?.toString() ?? ""}${this.body.map((node) => node.toString()).join("")}`;
  }

  public with(
    changes: Readonly<{
      name?: string;
      label?: DirectiveLabelNode | null;
      attributes?: DirectiveAttributes;
      body?: readonly FlowContent[];
    }>,
  ): ContainerDirectiveNode {
    const name = changes.name ?? this.name;
    const label = applyOptionalUpdate(this.label, changes.label);
    const attributes = changes.attributes ?? this.attributes;
    const body = changes.body ?? this.body;
    return name === this.name &&
      label === this.label &&
      sameDirectiveAttributes(attributes, this.attributes) &&
      sameSequence(this.body, body)
      ? this
      : new ContainerDirectiveNode(name, body, { label, attributes, origin: this.origin });
  }
}

export class InlineMathNode extends InlineNode<"inlineMath", never> {
  public readonly format: MathFormat;
  public readonly kind = "inlineMath";
  public readonly value: string;

  public constructor(
    value: string,
    options: Readonly<{ format: MathFormat; origin?: SourceSpan }>,
  ) {
    super([], options.origin);
    if (options.format === "tex" && value.includes("\\)")) {
      InputError.mathDelimiterCollision("inlineMath", "\\)");
    }
    this.format = options.format;
    this.value = value;
    Object.freeze(this);
  }

  public toString(): string {
    return this.value;
  }

  public with(changes: Readonly<{ value?: string; format?: MathFormat }>): InlineMathNode {
    const value = changes.value ?? this.value;
    const format = changes.format ?? this.format;
    return value === this.value && format === this.format
      ? this
      : new InlineMathNode(value, { format, origin: this.origin });
  }
}

export type DisplayMathOptions =
  | Readonly<{ format: "dollar"; meta?: string; origin?: SourceSpan }>
  | Readonly<{ format: "tex"; meta?: never; origin?: SourceSpan }>;

export class DisplayMathNode extends BlockNode<"displayMath", never> {
  public readonly format: MathFormat;
  public readonly kind = "displayMath";
  public readonly meta?: string;
  public readonly value: string;

  public constructor(value: string, options: DisplayMathOptions) {
    super([], options.origin);
    if (options.format === "tex") {
      if (options.meta !== undefined) {
        InputError.mathMetadataUnsupported();
      }
      if (value.includes("\\]")) {
        InputError.mathDelimiterCollision("displayMath", "\\]");
      }
    }
    this.format = options.format;
    this.value = value;
    this.meta = options.meta;
    Object.freeze(this);
  }

  public toString(): string {
    return this.value;
  }

  public with(
    changes: Readonly<{ value?: string; format?: MathFormat; meta?: string | null }>,
  ): DisplayMathNode {
    const value = changes.value ?? this.value;
    const format = changes.format ?? this.format;
    if (format === "tex") {
      if (changes.meta !== undefined && changes.meta !== null) {
        InputError.mathMetadataUnsupported();
      }
      return value === this.value && format === this.format && this.meta === undefined
        ? this
        : new DisplayMathNode(value, { format, origin: this.origin });
    }
    const meta = applyOptionalUpdate(this.meta, changes.meta);
    return value === this.value && format === this.format && meta === this.meta
      ? this
      : new DisplayMathNode(value, { format, meta, origin: this.origin });
  }
}

export type ReferenceKind = "full" | "collapsed" | "shortcut";

export class LinkReferenceNode extends InlineNode<"linkReference", PhrasingContent> {
  public readonly kind = "linkReference";
  public readonly identifier: string;
  public readonly referenceKind: ReferenceKind;
  public constructor(
    identifier: string,
    children: readonly PhrasingContent[],
    options: Readonly<{ referenceKind?: ReferenceKind; origin?: SourceSpan }> = {},
  ) {
    super(children, options.origin);
    this.identifier = normalizeIdentifier(identifier);
    this.referenceKind = options.referenceKind ?? "full";
    Object.freeze(this);
  }
  public with(
    changes: Readonly<{
      identifier?: string;
      referenceKind?: ReferenceKind;
      children?: readonly PhrasingContent[];
    }>,
  ): LinkReferenceNode {
    const identifier = normalizeIdentifier(changes.identifier ?? this.identifier);
    const referenceKind = changes.referenceKind ?? this.referenceKind;
    const children = changes.children ?? this.children;
    return identifier === this.identifier &&
      referenceKind === this.referenceKind &&
      sameSequence(this.children, children)
      ? this
      : new LinkReferenceNode(identifier, children, {
          referenceKind,
          origin: this.origin,
        });
  }
}

export class ImageReferenceNode extends InlineNode<"imageReference", never> {
  public readonly kind = "imageReference";
  public readonly identifier: string;
  public readonly alt: string;
  public readonly referenceKind: ReferenceKind;
  public constructor(
    identifier: string,
    alt: string,
    options: Readonly<{ referenceKind?: ReferenceKind; origin?: SourceSpan }> = {},
  ) {
    super([], options.origin);
    this.identifier = normalizeIdentifier(identifier);
    this.alt = alt;
    this.referenceKind = options.referenceKind ?? "full";
    Object.freeze(this);
  }
  public toString(): string {
    return this.alt;
  }
  public with(
    changes: Readonly<{
      identifier?: string;
      alt?: string;
      referenceKind?: ReferenceKind;
    }>,
  ): ImageReferenceNode {
    const identifier = normalizeIdentifier(changes.identifier ?? this.identifier);
    const alt = changes.alt ?? this.alt;
    const referenceKind = changes.referenceKind ?? this.referenceKind;
    return identifier === this.identifier &&
      alt === this.alt &&
      referenceKind === this.referenceKind
      ? this
      : new ImageReferenceNode(identifier, alt, { referenceKind, origin: this.origin });
  }
}

export class HardBreakNode extends InlineNode<"hardBreak", never> {
  public readonly kind = "hardBreak";
  public constructor(origin?: SourceSpan) {
    super([], origin);
    Object.freeze(this);
  }
  public toString(): string {
    return "\n";
  }
}

export class RawHtmlInlineNode extends InlineNode<"rawHtmlInline", never> {
  public readonly kind = "rawHtmlInline";
  public readonly value: string;
  public constructor(value: string, origin?: SourceSpan) {
    super([], origin);
    this.value = value;
    Object.freeze(this);
  }
  public toString(): string {
    return this.value;
  }
}

export class RawHtmlBlockNode extends BlockNode<"rawHtmlBlock", never> {
  public readonly kind = "rawHtmlBlock";
  public readonly value: string;
  public constructor(value: string, origin?: SourceSpan) {
    super([], origin);
    this.value = value;
    Object.freeze(this);
  }
  public toString(): string {
    return this.value;
  }
}

export class ParagraphNode extends BlockNode<"paragraph", PhrasingContent> {
  public readonly kind = "paragraph";
  public constructor(children: readonly PhrasingContent[], origin?: SourceSpan) {
    super(children, origin);
    Object.freeze(this);
  }
  public with(changes: Readonly<{ children?: readonly PhrasingContent[] }>): ParagraphNode {
    return changes.children === undefined || sameSequence(this.children, changes.children)
      ? this
      : new ParagraphNode(changes.children, this.origin);
  }
}

export class HeadingNode extends BlockNode<"heading", PhrasingContent> {
  public readonly kind = "heading";
  public readonly depth: HeadingDepth;
  public constructor(
    depth: HeadingDepth,
    children: readonly PhrasingContent[],
    origin?: SourceSpan,
  ) {
    super(children, origin);
    this.depth = depth;
    Object.freeze(this);
  }
  public with(
    changes: Readonly<{ depth?: HeadingDepth; children?: readonly PhrasingContent[] }>,
  ): HeadingNode {
    const depth = changes.depth ?? this.depth;
    const children = changes.children ?? this.children;
    return depth === this.depth && sameSequence(this.children, children)
      ? this
      : new HeadingNode(depth, children, this.origin);
  }
}

export class CodeBlockNode extends BlockNode<"codeBlock", never> {
  public readonly kind = "codeBlock";
  public readonly value: string;
  public readonly language?: string;
  public readonly meta?: string;
  public constructor(
    value: string,
    options: Readonly<{ language?: string; meta?: string; origin?: SourceSpan }> = {},
  ) {
    super([], options.origin);
    this.value = value;
    this.language = options.language;
    this.meta = options.meta;
    Object.freeze(this);
  }
  public toString(): string {
    return this.value;
  }
  public with(
    changes: Readonly<{ value?: string; language?: string | null; meta?: string | null }>,
  ): CodeBlockNode {
    const value = changes.value ?? this.value;
    const language = applyOptionalUpdate(this.language, changes.language);
    const meta = applyOptionalUpdate(this.meta, changes.meta);
    return value === this.value && language === this.language && meta === this.meta
      ? this
      : new CodeBlockNode(value, { language, meta, origin: this.origin });
  }
}

export class ThematicBreakNode extends BlockNode<"thematicBreak", never> {
  public readonly kind = "thematicBreak";
  public constructor(origin?: SourceSpan) {
    super([], origin);
    Object.freeze(this);
  }
}

export class BlockQuoteNode extends BlockNode<"blockquote", FlowContent> {
  public readonly kind = "blockquote";
  public constructor(children: readonly FlowContent[], origin?: SourceSpan) {
    super(children, origin);
    Object.freeze(this);
  }
  public with(changes: Readonly<{ children?: readonly FlowContent[] }>): BlockQuoteNode {
    return changes.children === undefined || sameSequence(this.children, changes.children)
      ? this
      : new BlockQuoteNode(changes.children, this.origin);
  }
}

export class ListItemNode extends BlockNode<"listItem", FlowContent> {
  public readonly kind = "listItem";
  public readonly checked?: boolean;
  public readonly spread: boolean;
  public constructor(
    children: readonly FlowContent[],
    options: Readonly<{ checked?: boolean; spread?: boolean; origin?: SourceSpan }> = {},
  ) {
    super(children, options.origin);
    this.checked = options.checked;
    this.spread = options.spread ?? false;
    Object.freeze(this);
  }
  public with(
    changes: Readonly<{
      checked?: boolean | null;
      spread?: boolean;
      children?: readonly FlowContent[];
    }>,
  ): ListItemNode {
    const checked = applyOptionalUpdate(this.checked, changes.checked);
    const spread = changes.spread ?? this.spread;
    const children = changes.children ?? this.children;
    return checked === this.checked &&
      spread === this.spread &&
      sameSequence(this.children, children)
      ? this
      : new ListItemNode(children, { checked, spread, origin: this.origin });
  }
}

export class ListNode extends BlockNode<"list", ListItemNode> {
  public readonly kind = "list";
  public readonly ordered: boolean;
  public readonly spread: boolean;
  public readonly start: number;
  public constructor(
    items: readonly ListItemNode[],
    options: Readonly<{
      ordered?: boolean;
      spread?: boolean;
      start?: number;
      origin?: SourceSpan;
    }> = {},
  ) {
    super(items, options.origin);
    this.ordered = options.ordered ?? false;
    this.spread = options.spread ?? false;
    this.start = options.start ?? 1;
    Object.freeze(this);
  }
  public get items(): readonly ListItemNode[] {
    return this.children;
  }
  public toString(): string {
    return this.items.map((item) => item.toString()).join("\n");
  }
  public with(
    changes: Readonly<{
      ordered?: boolean;
      spread?: boolean;
      start?: number;
      items?: readonly ListItemNode[];
    }>,
  ): ListNode {
    const ordered = changes.ordered ?? this.ordered;
    const spread = changes.spread ?? this.spread;
    const start = changes.start ?? this.start;
    const items = changes.items ?? this.items;
    return ordered === this.ordered &&
      spread === this.spread &&
      start === this.start &&
      sameSequence(this.items, items)
      ? this
      : new ListNode(items, { ordered, spread, start, origin: this.origin });
  }
}

export type TableAlignment = "center" | "left" | "none" | "right";

export class TableCellNode extends InlineNode<"tableCell", PhrasingContent> {
  public readonly kind = "tableCell";
  public constructor(children: readonly PhrasingContent[], origin?: SourceSpan) {
    super(children, origin);
    Object.freeze(this);
  }
  public with(changes: Readonly<{ children?: readonly PhrasingContent[] }>): TableCellNode {
    return changes.children === undefined || sameSequence(this.children, changes.children)
      ? this
      : new TableCellNode(changes.children, this.origin);
  }
}

export class TableRowNode extends BlockNode<"tableRow", TableCellNode> {
  public readonly kind = "tableRow";
  public constructor(children: readonly TableCellNode[], origin?: SourceSpan) {
    super(children, origin);
    Object.freeze(this);
  }
  public toString(): string {
    return this.children.map((cell) => cell.toString()).join("\t");
  }
  public with(changes: Readonly<{ children?: readonly TableCellNode[] }>): TableRowNode {
    return changes.children === undefined || sameSequence(this.children, changes.children)
      ? this
      : new TableRowNode(changes.children, this.origin);
  }
}

export class TableNode extends BlockNode<"table", TableRowNode> {
  public readonly alignments: readonly TableAlignment[];
  public readonly kind = "table";
  public constructor(
    alignments: readonly TableAlignment[],
    children: readonly TableRowNode[],
    origin?: SourceSpan,
  ) {
    super(children, origin);
    this.alignments = Object.freeze([...alignments]);
    Object.freeze(this);
  }
  public toString(): string {
    return this.children.map((row) => row.toString()).join("\n");
  }
  public with(
    changes: Readonly<{
      alignments?: readonly TableAlignment[];
      children?: readonly TableRowNode[];
    }>,
  ): TableNode {
    const alignments = changes.alignments ?? this.alignments;
    const children = changes.children ?? this.children;
    return sameSequence(this.alignments, alignments) && sameSequence(this.children, children)
      ? this
      : new TableNode(alignments, children, this.origin);
  }
}

export class DocumentNode extends BlockNode<"document", FlowContent> {
  public readonly kind = "document";
  private readonly definitionIndex: ReadonlyMap<string, DefinitionNode>;
  private readonly footnoteIndex: ReadonlyMap<string, FootnoteDefinitionNode>;
  public constructor(children: readonly FlowContent[], origin?: SourceSpan) {
    super(children, origin);
    const definitions = new Map<string, DefinitionNode>();
    const footnotes = new Map<string, FootnoteDefinitionNode>();
    for (const child of children) {
      for (const { node: definition } of selectTree<MdxNode, "definition">(
        child,
        "definition",
        (node) => node.children,
      )) {
        const identifier = normalizeIdentifier(definition.identifier);
        if (!definitions.has(identifier)) {
          definitions.set(identifier, definition);
        }
      }
      for (const { node: footnote } of selectTree<MdxNode, "footnoteDefinition">(
        child,
        "footnoteDefinition",
        (node) => node.children,
      )) {
        if (!footnotes.has(footnote.identifier)) {
          footnotes.set(footnote.identifier, footnote);
        }
      }
    }
    this.definitionIndex = definitions;
    this.footnoteIndex = footnotes;
    Object.freeze(this);
  }
  public definition(identifier: string): DefinitionNode | undefined {
    return this.definitionIndex.get(normalizeIdentifier(identifier));
  }
  public get frontmatter(): FrontmatterNode | undefined {
    const first = this.children[0];
    return first instanceof FrontmatterNode ? first : undefined;
  }
  public footnote(identifier: string): FootnoteDefinitionNode | undefined {
    return this.footnoteIndex.get(normalizeIdentifier(identifier));
  }
  public toString(): string {
    return this.children.map((child) => child.toString()).join("\n\n");
  }
  public with(changes: Readonly<{ children?: readonly FlowContent[] }>): DocumentNode {
    return changes.children === undefined || sameSequence(this.children, changes.children)
      ? this
      : new DocumentNode(changes.children, this.origin);
  }
}

export class InlineExpressionNode extends InlineNode<"inlineExpression", never> {
  public readonly kind = "inlineExpression";
  public readonly code: string;
  public constructor(code: string, origin?: SourceSpan) {
    super([], origin);
    this.code = code;
    Object.freeze(this);
  }
}
export class BlockExpressionNode extends BlockNode<"blockExpression", never> {
  public readonly kind = "blockExpression";
  public readonly code: string;
  public constructor(code: string, origin?: SourceSpan) {
    super([], origin);
    this.code = code;
    Object.freeze(this);
  }
}
export class EsmNode extends BlockNode<"esm", never> {
  public readonly kind = "esm";
  public readonly code: string;
  public constructor(code: string, origin?: SourceSpan) {
    super([], origin);
    this.code = code;
    Object.freeze(this);
  }
}

export class JsxAttributeValueExpressionNode extends SyntaxNode<"jsxAttributeValueExpression"> {
  public readonly children: readonly [] = Object.freeze([]);
  public readonly code: string;
  public readonly kind = "jsxAttributeValueExpression";
  public constructor(code: string, origin?: SourceSpan) {
    super(origin);
    this.code = code;
    Object.freeze(this);
  }
  public toString(): string {
    return "";
  }
}

export type JsxAttributeValue = string | JsxAttributeValueExpressionNode;

export class JsxAttributeNode extends SyntaxNode<"jsxAttribute"> {
  public readonly children: readonly JsxAttributeValueExpressionNode[];
  public readonly kind = "jsxAttribute";
  public readonly name: string;
  public readonly value?: JsxAttributeValue;
  public constructor(
    name: string,
    options: Readonly<{ value?: JsxAttributeValue; origin?: SourceSpan }> = {},
  ) {
    super(options.origin);
    this.name = name;
    this.value = options.value;
    this.children = Object.freeze(
      options.value instanceof JsxAttributeValueExpressionNode ? [options.value] : [],
    );
    Object.freeze(this);
  }
  public toString(): string {
    return "";
  }
  public with(
    changes: Readonly<{ name?: string; value?: JsxAttributeValue | null }>,
  ): JsxAttributeNode {
    const name = changes.name ?? this.name;
    const value = applyOptionalUpdate(this.value, changes.value);
    return name === this.name && value === this.value
      ? this
      : new JsxAttributeNode(name, { value, origin: this.origin });
  }
}

export class JsxSpreadAttributeNode extends SyntaxNode<"jsxSpreadAttribute"> {
  public readonly children: readonly [] = Object.freeze([]);
  public readonly code: string;
  public readonly kind = "jsxSpreadAttribute";
  public constructor(code: string, origin?: SourceSpan) {
    super(origin);
    this.code = code;
    Object.freeze(this);
  }
  public toString(): string {
    return "";
  }
}

export type JsxAttributeLike = JsxAttributeNode | JsxSpreadAttributeNode;

export class JsxTextElementNode extends InlineNode<"jsxTextElement", PhrasingContent> {
  public readonly attributes: readonly JsxAttributeLike[];
  public readonly kind = "jsxTextElement";
  public readonly name?: string;
  public constructor(
    name: string | undefined,
    attributes: readonly JsxAttributeLike[],
    children: readonly PhrasingContent[],
    origin?: SourceSpan,
  ) {
    super(children, origin);
    this.name = name;
    this.attributes = Object.freeze([...attributes]);
    Object.freeze(this);
  }
  public with(
    changes: Readonly<{
      name?: string | null;
      attributes?: readonly JsxAttributeLike[];
      children?: readonly PhrasingContent[];
    }>,
  ): JsxTextElementNode {
    const name = applyOptionalUpdate(this.name, changes.name);
    const attributes = changes.attributes ?? this.attributes;
    const children = changes.children ?? this.children;
    return name === this.name &&
      sameSequence(attributes, this.attributes) &&
      sameSequence(children, this.children)
      ? this
      : new JsxTextElementNode(name, attributes, children, this.origin);
  }
}

export class JsxFlowElementNode extends BlockNode<"jsxFlowElement", FlowContent> {
  public readonly attributes: readonly JsxAttributeLike[];
  public readonly kind = "jsxFlowElement";
  public readonly name?: string;
  public constructor(
    name: string | undefined,
    attributes: readonly JsxAttributeLike[],
    children: readonly FlowContent[],
    origin?: SourceSpan,
  ) {
    super(children, origin);
    this.name = name;
    this.attributes = Object.freeze([...attributes]);
    Object.freeze(this);
  }
  public toString(): string {
    return this.children.map((child) => child.toString()).join("\n\n");
  }
  public with(
    changes: Readonly<{
      name?: string | null;
      attributes?: readonly JsxAttributeLike[];
      children?: readonly FlowContent[];
    }>,
  ): JsxFlowElementNode {
    const name = applyOptionalUpdate(this.name, changes.name);
    const attributes = changes.attributes ?? this.attributes;
    const children = changes.children ?? this.children;
    return name === this.name &&
      sameSequence(attributes, this.attributes) &&
      sameSequence(children, this.children)
      ? this
      : new JsxFlowElementNode(name, attributes, children, this.origin);
  }
}

export type PhrasingContent =
  | TextNode
  | EmphasisNode
  | StrongNode
  | DeleteNode
  | InlineCodeNode
  | HardBreakNode
  | LinkNode
  | ImageNode
  | LinkReferenceNode
  | ImageReferenceNode
  | RawHtmlInlineNode
  | FootnoteReferenceNode
  | TextDirectiveNode
  | InlineMathNode
  | JsxTextElementNode
  | InlineExpressionNode;

export type FlowContent =
  | ParagraphNode
  | HeadingNode
  | CodeBlockNode
  | ThematicBreakNode
  | BlockQuoteNode
  | ListNode
  | DefinitionNode
  | RawHtmlBlockNode
  | FootnoteDefinitionNode
  | FrontmatterNode
  | LeafDirectiveNode
  | ContainerDirectiveNode
  | DisplayMathNode
  | TableNode
  | BlockExpressionNode
  | EsmNode
  | JsxFlowElementNode;

export type MdxNode =
  | DocumentNode
  | FlowContent
  | ListItemNode
  | TableRowNode
  | TableCellNode
  | DirectiveLabelNode
  | PhrasingContent
  | JsxAttributeNode
  | JsxAttributeValueExpressionNode
  | JsxSpreadAttributeNode;
