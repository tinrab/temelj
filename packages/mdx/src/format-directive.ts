import type { FormatContext, FormatInfo, FormatOptions } from "./format-context.ts";
import type {
  ContainerDirectiveNode,
  DirectiveAttribute,
  DirectiveLabelNode,
  LeafDirectiveNode,
  MdxNode,
  TextDirectiveNode,
} from "./model.ts";

import { FormatTracker } from "./format-track.ts";
import { mdxChildren } from "./model.ts";

// Directives, their labels, and their attributes.

export function formatDirective(
  context: FormatContext,
  node: TextDirectiveNode | LeafDirectiveNode,
  info: FormatInfo,
  sequence: ":" | "::",
): string {
  const exit = context.enter(node.kind);
  const tracker = new FormatTracker(info);
  let value = tracker.move(`${sequence}${node.name}`);

  if (node.label !== undefined) {
    value += tracker.move(
      formatDirectiveLabel(context, node.label, {
        after: "{",
        before: value,
        ...tracker.current(),
      }),
    );
  }

  value += tracker.move(formatDirectiveAttributes(node.attributes, context.options));
  exit();

  return value;
}

export function formatContainerDirective(
  context: FormatContext,
  node: ContainerDirectiveNode,
  info: FormatInfo,
): string {
  const exit = context.enter("containerDirective");
  const tracker = new FormatTracker(info);
  const sequence = ":".repeat(containerDirectiveFenceSize(node));
  let value = tracker.move(`${sequence}${node.name}`);

  if (node.label !== undefined) {
    value += tracker.move(
      formatDirectiveLabel(context, node.label, {
        after: "{",
        before: value,
        ...tracker.current(),
      }),
    );
  }

  value += tracker.move(formatDirectiveAttributes(node.attributes, context.options));

  if (node.children.length > 0) {
    value += tracker.move("\n");
    value += tracker.move(
      context.flow(node.children, {
        after: "\n",
        before: "\n",
        ...tracker.current(),
      }),
    );
  }

  value += tracker.move(`\n${sequence}`);
  exit();

  return value;
}

export function formatDirectiveLabel(
  context: FormatContext,
  node: DirectiveLabelNode,
  info: FormatInfo,
): string {
  const exit = context.enter("directiveLabel");
  const exitLabel = context.enter("label");
  const tracker = new FormatTracker(info);
  const opening = tracker.move("[");

  const content = tracker.move(
    context.phrasing(node.children, {
      after: "]",
      before: opening,
      ...tracker.current(),
    }),
  );

  exitLabel();
  exit();

  return `${opening}${content}]`;
}

export function containsDirective(node: MdxNode): boolean {
  return (
    node.kind === "textDirective" ||
    node.kind === "leafDirective" ||
    node.kind === "containerDirective" ||
    mdxChildren(node).some(containsDirective)
  );
}

function containerDirectiveFenceSize(node: ContainerDirectiveNode): number {
  let nested = 0;

  const visit = (child: MdxNode): void => {
    if (child.kind === "containerDirective") {
      nested = Math.max(nested, containerDirectiveFenceSize(child) - 2);
    } else {
      mdxChildren(child).forEach(visit);
    }
  };

  node.children.forEach(visit);

  return 3 + nested;
}

function formatDirectiveAttributes(
  entries: readonly DirectiveAttribute[],
  options: FormatOptions,
): string {
  if (entries.length === 0) {
    return "";
  }

  const shortcut = /^[^\t\n\r "#'.<=>`}]+$/u;
  const values: string[] = [];
  let id: string | undefined;
  const classes: string[] = [];
  const fullClasses: string[] = [];

  for (const entry of entries) {
    if (entry.name === "id" && shortcut.test(entry.value)) {
      id = `#${entry.value}`;
    } else if (entry.name === "class") {
      for (const className of entry.value.split(/[\t\n\r ]+/u)) {
        if (className.length === 0) {
          continue;
        }

        if (shortcut.test(className)) {
          classes.push(className);
        } else {
          fullClasses.push(className);
        }
      }
    } else {
      values.push(formatDirectiveAttribute(entry.name, entry.value, options));
    }
  }

  if (fullClasses.length > 0) {
    values.unshift(formatDirectiveAttribute("class", fullClasses.join(" "), options));
  }

  if (classes.length > 0) {
    values.unshift(`.${classes.join(".")}`);
  }

  if (id !== undefined) {
    values.unshift(id);
  }

  return `{${values.join(" ")}}`;
}

function formatDirectiveAttribute(name: string, value: string, options: FormatOptions): string {
  if (value.length === 0) {
    return name;
  }

  const quote = options.quote ?? '"';

  const encoded = value.replace(/[&\r\n"']/gu, (character) => {
    if (character === "&") {
      return "&amp;";
    }

    if (character === "\r") {
      return "&#xD;";
    }

    if (character === "\n") {
      return "&#xA;";
    }

    if (character === quote) {
      return quote === '"' ? "&quot;" : "&#x27;";
    }

    return character;
  });

  return `${name}=${quote}${encoded}${quote}`;
}
