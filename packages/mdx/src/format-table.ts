import type { FormatContext, FormatInfo } from "./format-context.ts";
import type { TableCellNode, TableNode, TableRowNode } from "./model.ts";

// GFM tables.

export function formatTable(context: FormatContext, node: TableNode, info: FormatInfo): string {
  const columns = node.alignments.length;

  if (columns === 0) {
    return "";
  }

  const exit = context.enter("table");

  const matrix = node.children.map((row) =>
    Array.from({ length: columns }, (_, index) =>
      row.children[index] === undefined ? "" : formatTableCell(context, row.children[index], info),
    ),
  );

  if (matrix.length === 0) {
    matrix.push(Array.from({ length: columns }, () => ""));
  }

  const measure = context.options.tableStringLength ?? ((value: string): number => value.length);
  const alignPipes = context.options.tablePipeAlign !== false;

  const widths = Array.from({ length: columns }, (_, column) => {
    const content = alignPipes ? Math.max(...matrix.map((row) => measure(row[column] ?? ""))) : 0;

    return Math.max(3, content);
  });

  const delimiter = node.alignments.map((alignment, column) =>
    tableDelimiter(alignment, widths[column]),
  );

  const rows = [matrix[0], delimiter, ...matrix.slice(1)].map((row) =>
    serializeTableRow(row, widths, context.options.tableCellPadding !== false, measure),
  );

  exit();

  return rows.join("\n");
}

export function formatTableRow(
  context: FormatContext,
  node: TableRowNode,
  info: FormatInfo,
): string {
  const values = node.children.map((cell) => formatTableCell(context, cell, info));

  return serializeTableRow(
    values,
    values.map((value) => Math.max(3, value.length)),
    context.options.tableCellPadding !== false,
    (value) => value.length,
  );
}

export function formatTableCell(
  context: FormatContext,
  node: TableCellNode,
  info: FormatInfo,
): string {
  const exitCell = context.enter("tableCell");
  const exitPhrasing = context.enter("phrasing");
  const value = context.phrasing(node.children, { ...info, after: "|", before: "|" });
  exitPhrasing();
  exitCell();

  return value;
}

function tableDelimiter(alignment: TableNode["alignments"][number], width: number): string {
  if (alignment === "center") {
    return `:${"-".repeat(Math.max(1, width - 2))}:`;
  }

  if (alignment === "left") {
    return `:${"-".repeat(Math.max(2, width - 1))}`;
  }

  if (alignment === "right") {
    return `${"-".repeat(Math.max(2, width - 1))}:`;
  }

  return "-".repeat(width);
}

function serializeTableRow(
  values: readonly string[],
  widths: readonly number[],
  padding: boolean,
  measure: (value: string) => number,
): string {
  const cells = widths.map((width, index) => {
    const value = values[index] ?? "";
    const tail = " ".repeat(Math.max(0, width - measure(value)));

    return padding ? ` ${value}${tail} ` : `${value}${tail}`;
  });

  return `|${cells.join("|")}|`;
}
