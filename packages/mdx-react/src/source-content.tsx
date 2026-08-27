import type {
  CompletedBlockSnapshot,
  Diagnostic,
  HtmlAttributeValue,
  HtmlNode,
  MdxStreamSnapshot,
  ProcessOutcome,
  StreamingJsx,
  StreamingNode,
  StreamingPendingMarkdownNode,
  SyntaxOptions,
} from "@temelj/mdx";

import {
  HtmlCommentNode,
  HtmlCodeBlockNode,
  HtmlDoctypeNode,
  HtmlDocumentNode,
  HtmlFragmentNode,
  HtmlJsxNode,
  HtmlMathNode,
  HtmlRawNode,
  HtmlTextNode,
  MdxStream,
  Processor,
  StreamingDocument,
  hasErrorDiagnostics,
  isHtmlAttributeList,
} from "@temelj/mdx";
import { find, hastToReact, html, svg, type Schema } from "property-information";
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import styleToJs from "style-to-js";

import type { MdxRegistry } from "./registry.ts";
import type { MathComponent } from "./types.ts";

import { reservedMdxProps } from "./types.ts";

export type DiagnosticFallback =
  | React.ReactNode
  | ((diagnostics: readonly Diagnostic[]) => React.ReactNode);

export interface SourceContentProps {
  readonly source: string;
  readonly components?: MdxRegistry;
  readonly diagnosticFallback?: DiagnosticFallback;
  readonly math?: MathComponent;
  readonly onDiagnostics?: (diagnostics: readonly Diagnostic[]) => void;
  readonly syntax?: SyntaxOptions;
}

export interface StreamingSourceContentProps extends SourceContentProps {
  readonly status: "streaming" | "complete";
}

const defaultProcessor = new Processor();

type ProcessedOutcome = Extract<ProcessOutcome, { kind: "processed" }>;
type StreamingView =
  | Readonly<{ kind: "streaming"; snapshot: MdxStreamSnapshot }>
  | Readonly<{
      kind: "complete";
      outcome: ProcessOutcome;
      blocks: readonly CompletedBlockSnapshot[];
    }>;

class StreamingSourceStore {
  private readonly listeners = new Set<() => void>();
  private readonly processor: Processor;
  private stream: MdxStream;
  private view: StreamingView;
  private source: string;
  private status: StreamingSourceContentProps["status"];

  public constructor(
    processor: Processor,
    source: string,
    status: StreamingSourceContentProps["status"],
  ) {
    this.processor = processor;
    this.stream = new MdxStream({ source, syntax: processor.syntax });
    this.source = source;
    this.status = status;
    this.view = this.read(status);
  }

  public readonly getSnapshot = (): StreamingView => this.view;

  public readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public update(source: string, status: StreamingSourceContentProps["status"]): void {
    if (source === this.source && status === this.status) {
      return;
    }
    const wasComplete = this.view.kind === "complete" && this.view.outcome.kind === "processed";
    if (wasComplete) {
      this.stream = new MdxStream({ source, syntax: this.processor.syntax });
    } else if (source.startsWith(this.source)) {
      this.stream.append(source.slice(this.source.length));
    } else if (source !== this.source) {
      this.stream.edit(sourceEdit(this.source, source));
    }
    this.source = source;
    this.status = status;
    this.view = this.read(status);
    for (const listener of this.listeners) {
      listener();
    }
  }

  private read(status: StreamingSourceContentProps["status"]): StreamingView {
    if (status === "streaming") {
      const snapshot = this.stream.snapshot();
      if ("kind" in snapshot) {
        this.stream = new MdxStream({ source: snapshot.file, syntax: this.processor.syntax });
        const restarted = this.stream.snapshot();
        if ("kind" in restarted) {
          throw new Error("A new MdxStream cannot be complete");
        }
        return { kind: "streaming", snapshot: restarted };
      }
      return { kind: "streaming", snapshot };
    }
    const completion = this.stream.complete();
    if (completion.kind !== "parsed") {
      return { kind: "complete", outcome: completion, blocks: [] };
    }
    return {
      kind: "complete",
      outcome: this.processor.processSync(completion),
      blocks: completion.blocks,
    };
  }
}

function sourceEdit(
  previous: string,
  next: string,
): Readonly<{
  start: number;
  end: number;
  text: string;
}> {
  let start = 0;
  const sharedLength = Math.min(previous.length, next.length);
  while (start < sharedLength && previous[start] === next[start]) {
    start++;
  }
  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previous[previousEnd - 1] === next[nextEnd - 1]
  ) {
    previousEnd--;
    nextEnd--;
  }
  return Object.freeze({ start, end: previousEnd, text: next.slice(start, nextEnd) });
}

export function SourceContent({
  source,
  components,
  diagnosticFallback,
  math,
  onDiagnostics,
  syntax,
}: SourceContentProps): React.ReactNode {
  const processor = useMemo(
    () => (syntax === undefined ? defaultProcessor : new Processor({ syntax })),
    [syntax],
  );
  const outcome = useMemo(() => processor.processSync(source), [processor, source]);
  useDiagnostics(onDiagnostics, outcome.diagnostics);
  if (outcome.kind !== "processed" || hasErrorDiagnostics(outcome.diagnostics)) {
    return fallback(diagnosticFallback, outcome.diagnostics);
  }
  return renderDocument(outcome.value.html, components, math);
}

export interface ProcessedContentProps {
  readonly components?: MdxRegistry;
  readonly diagnosticFallback?: DiagnosticFallback;
  readonly math?: MathComponent;
  readonly onDiagnostics?: (diagnostics: readonly Diagnostic[]) => void;
  readonly outcome: ProcessOutcome;
}

/** Renders a document processed outside React. */
export function ProcessedContent({
  components,
  diagnosticFallback,
  math,
  onDiagnostics,
  outcome,
}: ProcessedContentProps): React.ReactNode {
  useDiagnostics(onDiagnostics, outcome.diagnostics);
  return outcome.kind !== "processed" || hasErrorDiagnostics(outcome.diagnostics)
    ? fallback(diagnosticFallback, outcome.diagnostics)
    : renderDocument(outcome.value.html, components, math);
}

export interface HtmlNodeContentProps {
  readonly components?: MdxRegistry;
  readonly math?: MathComponent;
  readonly node: HtmlNode;
}

export function HtmlNodeContent({ node, components, math }: HtmlNodeContentProps): React.ReactNode {
  return renderNode(node, components, math, 0, false);
}

export function StreamingSourceContent({
  source,
  status,
  components,
  diagnosticFallback,
  math,
  onDiagnostics,
  syntax,
}: StreamingSourceContentProps): React.ReactNode {
  const processor = useMemo(
    () => (syntax === undefined ? defaultProcessor : new Processor({ syntax })),
    [syntax],
  );
  const [initial] = useState(() => ({ source, status }));
  const store = useMemo(
    () => new StreamingSourceStore(processor, initial.source, initial.status),
    [initial, processor],
  );
  useEffect(() => store.update(source, status), [source, status, store]);
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const diagnostics =
    view.kind === "streaming" ? view.snapshot.diagnostics : view.outcome.diagnostics;
  useDiagnostics(onDiagnostics, diagnostics);
  if (hasErrorDiagnostics(diagnostics)) {
    return fallback(diagnosticFallback, diagnostics);
  }
  if (view.kind === "streaming") {
    const supplement = streamingSupplement(view.snapshot);
    const rendered = view.snapshot.blocks.map((block) => (
      <StableBlockContent
        key={block.id}
        content={{ kind: "streaming", document: block.document, math }}
        registry={components}
      />
    ));
    if (supplement !== undefined) {
      rendered.push(
        <StableBlockContent
          key="document-footnotes"
          content={{ kind: "streaming", document: supplement, math }}
          registry={components}
        />,
      );
    }
    return rendered;
  }
  if (view.outcome.kind !== "processed") {
    return fallback(diagnosticFallback, view.outcome.diagnostics);
  }
  return renderCompletedDocument(view.outcome, view.blocks, components, math);
}

function streamingSupplement(snapshot: MdxStreamSnapshot): StreamingDocument | undefined {
  const sourceNodes = new Set(snapshot.blocks.flatMap((block) => block.document.children));
  const children = snapshot.document.children.filter((node) => !sourceNodes.has(node));
  return children.length === 0 ? undefined : new StreamingDocument(children);
}

interface StableBlockContentProps {
  content:
    | Readonly<{
        kind: "streaming";
        document: MdxStreamSnapshot["document"];
        math?: MathComponent;
      }>
    | Readonly<{ kind: "complete"; nodes: readonly HtmlNode[]; math?: MathComponent }>;
  registry: MdxRegistry | undefined;
}

const StableBlockContent = React.memo(function StableBlockContent({
  content,
  registry,
}: Readonly<StableBlockContentProps>): React.ReactNode {
  return content.kind === "streaming"
    ? renderStreamingChildren(content.document.children, registry, content.math, false)
    : renderChildren(content.nodes, registry, content.math, false);
}, sameStableBlockContent);

function sameStableBlockContent(
  previous: Readonly<StableBlockContentProps>,
  next: Readonly<StableBlockContentProps>,
): boolean {
  return (
    previous.registry === next.registry &&
    previous.content.kind === "streaming" &&
    next.content.kind === "streaming" &&
    previous.content.document === next.content.document &&
    previous.content.math === next.content.math
  );
}

function renderCompletedDocument(
  outcome: ProcessedOutcome,
  blocks: readonly CompletedBlockSnapshot[],
  components: MdxRegistry | undefined,
  math: MathComponent | undefined,
): React.ReactNode {
  return completedRenderGroups(outcome.value.html.children, blocks).map((group) => (
    <StableBlockContent
      key={group.key}
      content={{ kind: "complete", nodes: group.nodes, math }}
      registry={components}
    />
  ));
}

interface HtmlRenderGroup {
  readonly baseKey: string;
  readonly key: string;
  readonly nodes: HtmlNode[];
}

function completedRenderGroups(
  nodes: readonly HtmlNode[],
  blocks: readonly CompletedBlockSnapshot[],
): readonly HtmlRenderGroup[] {
  const groups: HtmlRenderGroup[] = [];
  const occurrences = new Map<string, number>();
  for (const [index, node] of nodes.entries()) {
    const block = blockForHtmlNode(node, blocks);
    const baseKey = isFootnoteSection(node)
      ? "document-footnotes"
      : (block?.id ?? `completed-node-${index}`);
    const previous = groups.at(-1);
    if (previous?.baseKey === baseKey) {
      previous.nodes.push(node);
      continue;
    }
    const occurrence = occurrences.get(baseKey) ?? 0;
    occurrences.set(baseKey, occurrence + 1);
    groups.push({
      baseKey,
      key: occurrence === 0 ? baseKey : `${baseKey}-${occurrence}`,
      nodes: [node],
    });
  }
  return groups;
}

function isFootnoteSection(node: HtmlNode): boolean {
  return node.kind === "element" && Object.hasOwn(node.attributes, "data-footnotes");
}

function blockForHtmlNode(
  node: HtmlNode,
  blocks: readonly CompletedBlockSnapshot[],
): CompletedBlockSnapshot | undefined {
  const origin = node.origin;
  if (origin === undefined) {
    return;
  }
  return blocks.find((block) => block.range.start <= origin.start && origin.end <= block.range.end);
}

function renderStreamingChildren(
  children: readonly StreamingNode[],
  registry: MdxRegistry | undefined,
  math: MathComponent | undefined,
  inSvg: boolean,
): React.ReactNode[] {
  return children.map((child, index) =>
    renderStreamingNode(child, registry, math, String(index), inSvg),
  );
}

function renderStreamingNode(
  node: StreamingNode,
  registry: MdxRegistry | undefined,
  math: MathComponent | undefined,
  key: React.Key,
  inSvg: boolean,
): React.ReactNode {
  switch (node.kind) {
    case "text":
    case "raw":
      return node.value;
    case "omitted":
    case "pendingEsm":
      return null;
    case "pendingExpression":
      return node.authored;
    case "pendingMath":
      return node.authored;
    case "codeBlock":
      return renderNode(new HtmlCodeBlockNode(node.codeBlock), registry, math, key, inSvg);
    case "math":
      return math === undefined
        ? renderStreamingMathFallback(node, key)
        : React.createElement(math, { key, ...node.math });
    case "pendingStrong":
    case "pendingEmphasis":
    case "pendingDelete":
    case "pendingCode":
    case "pendingLink":
    case "pendingImage":
    case "pendingFencedCode":
    case "unresolvedLinkReference":
    case "unresolvedImageReference":
    case "unresolvedFootnoteReference":
    case "footnoteReference":
    case "footnoteSection":
      return renderPendingMarkdown(node, registry, math, key, inSvg);
    case "jsx":
      return renderStreamingJsx(node, registry, math, key);
    case "element": {
      const custom = registry?.html[node.tagName];
      const currentSvg = inSvg || node.tagName === "svg";
      const children = renderStreamingChildren(
        node.children,
        registry,
        math,
        currentSvg && node.tagName !== "foreignObject",
      );
      const attributes = reactAttributes(node.attributes, currentSvg ? svg : html);
      return custom === undefined
        ? React.createElement(
            IntrinsicElementContent,
            {
              attributes,
              key,
              tagName: node.tagName,
            },
            children,
          )
        : React.createElement(custom, { ...attributes, key, node }, ...children);
    }
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

function renderPendingMarkdown(
  node: StreamingPendingMarkdownNode,
  registry: MdxRegistry | undefined,
  math: MathComponent | undefined,
  key: React.Key,
  inSvg: boolean,
): React.ReactNode {
  const rendered = renderDefaultPendingMarkdown(node, registry, math, key, inSvg);
  const Pending = registry?.pending.markdown;
  if (Pending !== undefined) {
    return (
      <Pending key={key} node={node}>
        {rendered}
      </Pending>
    );
  }
  return rendered;
}

function renderDefaultPendingMarkdown(
  node: StreamingPendingMarkdownNode,
  registry: MdxRegistry | undefined,
  math: MathComponent | undefined,
  key: React.Key,
  inSvg: boolean,
): React.ReactNode {
  if (node.kind === "footnoteReference" || node.kind === "footnoteSection") {
    return renderStreamingNode(node.content, registry, math, key, inSvg);
  }
  const children = pendingMarkdownChildren(node, registry, math, inSvg);
  switch (node.kind) {
    case "pendingStrong":
      return <strong key={key}>{children}</strong>;
    case "pendingEmphasis":
      return <em key={key}>{children}</em>;
    case "pendingDelete":
      return <del key={key}>{children}</del>;
    case "pendingCode":
      return <code key={key}>{children}</code>;
    case "pendingLink":
      return <span key={key}>{children}</span>;
    case "pendingImage":
      return children;
    case "pendingFencedCode":
      return (
        <pre key={key}>
          <code>{children}</code>
        </pre>
      );
    case "unresolvedLinkReference":
    case "unresolvedImageReference":
    case "unresolvedFootnoteReference":
      return node.authored;
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

function pendingMarkdownChildren(
  node: Exclude<
    StreamingPendingMarkdownNode,
    { readonly kind: "footnoteReference" | "footnoteSection" }
  >,
  registry: MdxRegistry | undefined,
  math: MathComponent | undefined,
  inSvg: boolean,
): React.ReactNode {
  switch (node.kind) {
    case "pendingStrong":
    case "pendingEmphasis":
    case "pendingDelete":
    case "pendingLink":
    case "unresolvedLinkReference":
      return renderStreamingChildren(node.children, registry, math, inSvg);
    case "pendingCode":
    case "pendingFencedCode":
      return node.value;
    case "pendingImage":
    case "unresolvedImageReference":
      return node.alt;
    case "unresolvedFootnoteReference":
      return node.authored;
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

function renderStreamingMathFallback(
  node: Extract<StreamingNode, { kind: "math" }>,
  key: React.Key,
): React.ReactNode {
  if (node.math.style === "inline") {
    return (
      <code className="language-math math-inline" key={key}>
        {node.math.source}
      </code>
    );
  }
  return (
    <pre data-math-meta={node.math.meta} key={key}>
      <code className="language-math math-display">
        {node.math.source.length === 0 ? "" : `${node.math.source}\n`}
      </code>
    </pre>
  );
}

function renderStreamingJsx(
  node: StreamingJsx,
  registry: MdxRegistry | undefined,
  math: MathComponent | undefined,
  key: React.Key,
): React.ReactNode {
  if (!node.safe) {
    return node.state === "complete" ? node.authored : null;
  }
  if (node.name === undefined || registry === undefined) {
    return node.state === "complete" ? node.authored : null;
  }
  const entry = registry.jsx[node.name];
  if (entry === undefined) {
    return node.state === "complete" ? node.authored : null;
  }
  if (Object.keys(node.attributes).some((name) => reservedJsxProps.has(name))) {
    return node.state === "complete" ? node.authored : null;
  }
  const children = renderStreamingChildren(node.children, registry, math, false);
  if (node.state === "complete") {
    return React.createElement(entry.component, { ...node.attributes, key, node }, ...children);
  }
  if (entry.pending === null) {
    return null;
  }
  const props = { ...node.attributes, children, node };
  if (entry.pending !== undefined) {
    return React.createElement(entry.pending, { ...props, key });
  }
  if (registry.pending.jsx === undefined) {
    return null;
  }
  const Pending = registry.pending.jsx;
  return (
    <Pending key={key} name={node.name} node={node} props={node.attributes}>
      {children}
    </Pending>
  );
}

const reservedJsxProps: ReadonlySet<string> = new Set(reservedMdxProps);

function renderDocument(
  document: HtmlDocumentNode,
  components: MdxRegistry | undefined,
  math: MathComponent | undefined,
): React.ReactNode {
  return renderChildren(document.children, components, math, false);
}

function renderChildren(
  children: readonly HtmlNode[],
  registry: MdxRegistry | undefined,
  math: MathComponent | undefined,
  inSvg: boolean,
): React.ReactNode[] {
  return children.map((child, index) => renderNode(child, registry, math, String(index), inSvg));
}

function renderNode(
  node: HtmlNode,
  registry: MdxRegistry | undefined,
  math: MathComponent | undefined,
  key: React.Key,
  inSvg: boolean,
): React.ReactNode {
  if (node instanceof HtmlJsxNode) {
    const name = node.request.node.name;
    const entry = name === undefined ? undefined : registry?.jsx[name];
    const attributes = staticStrictJsxAttributes(node);
    if (entry === undefined || attributes === undefined) {
      return node.value;
    }
    const children = renderChildren(node.request.children, registry, math, false);
    return React.createElement(
      entry.component,
      { ...attributes, key, node: node.request.node },
      ...children,
    );
  }
  if (node instanceof HtmlTextNode || node instanceof HtmlRawNode) {
    return node.value;
  }
  if (node instanceof HtmlCommentNode || node instanceof HtmlDoctypeNode) {
    return null;
  }
  if (node instanceof HtmlDocumentNode || node instanceof HtmlFragmentNode) {
    return (
      <React.Fragment key={key}>
        {renderChildren(node.children, registry, math, inSvg)}
      </React.Fragment>
    );
  }
  if (math !== undefined && node instanceof HtmlMathNode) {
    return React.createElement(math, { key, ...node.math });
  }
  const custom = registry?.html[node.tagName];
  const currentSvg = inSvg || node.tagName === "svg";
  const children = renderChildren(
    node.children,
    registry,
    math,
    currentSvg && node.tagName !== "foreignObject",
  );
  const attributes = reactAttributes(node.attributes, currentSvg ? svg : html);
  return custom === undefined
    ? React.createElement(
        IntrinsicElementContent,
        {
          attributes,
          key,
          tagName: node.tagName,
        },
        children,
      )
    : React.createElement(custom, { ...attributes, key, node }, ...children);
}

interface IntrinsicElementContentProps {
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly children?: React.ReactNode;
  readonly tagName: string;
}

function IntrinsicElementContent({
  attributes,
  children,
  tagName,
}: IntrinsicElementContentProps): React.ReactNode {
  return React.createElement(tagName, attributes, ...React.Children.toArray(children));
}

function staticStrictJsxAttributes(
  node: HtmlJsxNode,
): Readonly<Record<string, boolean | string>> | undefined {
  const attributes: Record<string, boolean | string> = {};
  for (const attribute of node.request.node.attributes) {
    if (attribute.kind !== "jsxAttribute" || typeof attribute.value === "object") {
      return;
    }
    if (reservedJsxProps.has(attribute.name)) {
      return;
    }
    attributes[attribute.name] = attribute.value ?? true;
  }
  return attributes;
}

function reactAttributes(
  attributes: Readonly<Record<string, HtmlAttributeValue>>,
  schema: Schema,
): Readonly<Record<string, boolean | number | string | Readonly<Record<string, string>>>> {
  const result: Record<string, boolean | number | string | Readonly<Record<string, string>>> = {};
  for (const [name, value] of Object.entries(attributes)) {
    const reactName = reactAttributeName(name, schema);
    const serialized = isHtmlAttributeList(value) ? value.join(" ") : value;
    result[reactName] =
      reactName === "style" && typeof serialized === "string"
        ? styleToJs(serialized, { reactCompat: true })
        : serialized;
  }
  return result;
}

function reactAttributeName(name: string, schema: Schema): string {
  const information = find(schema, name);
  if (information.attribute.startsWith("aria-") || information.attribute.startsWith("data-")) {
    return information.attribute;
  }
  return hastToReact[information.property] ?? information.property;
}

function fallback(
  value: DiagnosticFallback | undefined,
  diagnostics: readonly Diagnostic[],
): React.ReactNode {
  return typeof value === "function" ? value(diagnostics) : (value ?? null);
}

function useDiagnostics(
  onDiagnostics: ((diagnostics: readonly Diagnostic[]) => void) | undefined,
  diagnostics: readonly Diagnostic[],
): void {
  const delivered = useRef<Readonly<{
    callback: (diagnostics: readonly Diagnostic[]) => void;
    diagnostics: readonly Diagnostic[];
  }> | null>(null);
  useEffect(() => {
    if (
      onDiagnostics === undefined ||
      (delivered.current?.callback === onDiagnostics &&
        delivered.current.diagnostics === diagnostics)
    ) {
      return;
    }
    delivered.current = { callback: onDiagnostics, diagnostics };
    onDiagnostics(diagnostics);
  }, [diagnostics, onDiagnostics]);
}
