// Derived from @aiden0z/pptx-renderer 1.4.0 (Apache-2.0); modified for Blok. See NOTICE.
/**
 * Table node parser — handles graphicFrame elements containing a:tbl.
 */

import { SafeXmlNode } from '../../parser/XmlParser';
import { BaseNodeData, parseBaseProps } from './BaseNode';
import { TextBody, parseTextBody } from './ShapeNode';
import { emuToPx } from '../../parser/units';
import { parseOoxmlBool } from '../../parser/booleans';

export interface TableCell {
  gridSpan: number;
  rowSpan: number;
  hMerge: boolean;
  vMerge: boolean;
  textBody?: TextBody;
  /** @internal Raw XML node — opaque to consumers. Use serializePresentation() for JSON-safe data. */
  properties?: SafeXmlNode;
}

export interface TableRow {
  height: number;
  cells: TableCell[];
}

export interface TableNodeData extends BaseNodeData {
  nodeType: 'table';
  columns: number[];
  rows: TableRow[];
  /** @internal Raw XML node — opaque to consumers. Use serializePresentation() for JSON-safe data. */
  properties?: SafeXmlNode;
  tableStyleId?: string;
  /** @internal The grid passes MAX_TABLE_CELLS, so its cells were not parsed. */
  oversized?: boolean;
}

// A hostile deck can declare a huge grid: 10,000 cells already cost about 450 MB
// and 400 ms in Chromium, while real slide tables stay far below that.
export const MAX_TABLE_CELLS = 10_000;

/** Counts rows times the widest of the declared grid and the longest row. */
export function tableCellCount(rows: number, gridColumns: number, longestRow: number): number {
  return rows * Math.max(gridColumns, longestRow);
}

/**
 * Parse a single table cell (`a:tc`).
 */
function parseCell(tcNode: SafeXmlNode): TableCell {
  const gridSpan = tcNode.numAttr('gridSpan') ?? 1;
  const rowSpan = tcNode.numAttr('rowSpan') ?? 1;
  const hMerge = parseOoxmlBool(tcNode.attr('hMerge'));
  const vMerge = parseOoxmlBool(tcNode.attr('vMerge'));

  // Cell text body
  const txBody = tcNode.child('txBody');
  const textBody = parseTextBody(txBody);

  // Cell properties
  const tcPr = tcNode.child('tcPr');

  return {
    gridSpan,
    rowSpan,
    hMerge,
    vMerge,
    textBody,
    properties: tcPr.exists() ? tcPr : undefined,
  };
}

/**
 * Parse a table row (`a:tr`).
 */
function parseRow(trNode: SafeXmlNode): TableRow {
  const height = emuToPx(trNode.numAttr('h') ?? 0);
  const cells: TableCell[] = [];

  for (const tcNode of trNode.children('tc')) {
    cells.push(parseCell(tcNode));
  }

  return { height, cells };
}

/**
 * Locate the `a:tbl` element inside a graphicFrame.
 * Path: `a:graphic > a:graphicData > a:tbl`
 */
function findTable(frameNode: SafeXmlNode): SafeXmlNode {
  const graphic = frameNode.child('graphic');
  const graphicData = graphic.child('graphicData');
  return graphicData.child('tbl');
}

/**
 * Extract the table style ID from tblPr.
 * It can be in `a:tblStyle@val` or as a direct `tblStyle` attribute.
 */
function extractTableStyleId(tblPr: SafeXmlNode): string | undefined {
  // Try <a:tableStyleId>{UUID}</a:tableStyleId> (most common in OOXML)
  const tableStyleIdNode = tblPr.child('tableStyleId');
  if (tableStyleIdNode.exists()) {
    return tableStyleIdNode.text() || tableStyleIdNode.attr('val') || undefined;
  }
  // Try <a:tblStyle val="{UUID}"/>
  const tblStyleNode = tblPr.child('tblStyle');
  if (tblStyleNode.exists()) {
    return tblStyleNode.attr('val') ?? (tblStyleNode.text() || undefined);
  }
  // Try direct attribute
  return tblPr.attr('tblStyle') ?? undefined;
}

/**
 * Parse a graphicFrame XML node containing a table into TableNodeData.
 */
export function parseTableNode(frameNode: SafeXmlNode): TableNodeData {
  const base = parseBaseProps(frameNode);
  const tbl = findTable(frameNode);

  // --- Column widths ---
  const tblGrid = tbl.child('tblGrid');
  const columns: number[] = [];
  for (const gridCol of tblGrid.children('gridCol')) {
    columns.push(emuToPx(gridCol.numAttr('w') ?? 0));
  }

  // --- Rows ---
  const trNodes = tbl.children('tr');
  const longestRow = trNodes.reduce((longest, trNode) => Math.max(longest, trNode.children('tc').length), 0);
  const oversized = tableCellCount(trNodes.length, columns.length, longestRow) > MAX_TABLE_CELLS;
  const rows: TableRow[] = oversized ? [] : trNodes.map(parseRow);

  const gridWidth = columns.reduce((sum, width) => sum + width, 0);
  const gridHeight = trNodes.reduce((sum, trNode) => sum + emuToPx(trNode.numAttr('h') ?? 0), 0);

  // --- Table properties ---
  const tblPr = tbl.child('tblPr');
  const tableStyleId = extractTableStyleId(tblPr);

  return {
    ...base,
    size: {
      w: gridWidth > 0 ? gridWidth : base.size.w,
      h: gridHeight > 0 ? gridHeight : base.size.h,
    },
    nodeType: 'table',
    columns,
    rows,
    properties: tblPr.exists() ? tblPr : undefined,
    tableStyleId,
    ...(oversized ? { oversized } : {}),
  };
}
