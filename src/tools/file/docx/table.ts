import type { RenderContext } from './context';
import type { TableCondition, TableStyleNode } from './styles';
import { nested } from './context';
import { borderCss, mergeCss, mergePara, parseParaProps, parseRunProps, shading } from './props';
import { attr, kid, kids, num, round, twips, val } from './xml';

/** Upper bound for spans and filler widths from the document. */
const MAX_SPAN = 1000;
/** How many sdt/customXml wrappers we look through around a row or cell. */
const MAX_UNWRAP = 8;
/**
 * Cell margins (twips) when nothing sets them. These are the values Word
 * writes into its default "Normal Table" style, which StyleSheet cannot look up.
 */
const DEFAULT_MARGIN: Record<Side, number> = { top: 0, bottom: 0, left: 108, right: 108 };

type Side = 'top' | 'bottom' | 'left' | 'right';

const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];

/** OOXML names for a physical side; start/end are read as left/right. */
const SIDE_NAMES: Record<Side, string[]> = { top: ['top'], bottom: ['bottom'], left: ['left', 'start'], right: ['right', 'end'] };

const VALIGN: Record<string, string> = { top: 'top', center: 'middle', bottom: 'bottom' };

const ON = new Set(['1', 'true', 'on']);

interface Look {
  firstRow: boolean;
  lastRow: boolean;
  firstColumn: boolean;
  lastColumn: boolean;
  noHBand: boolean;
  noVBand: boolean;
}

interface Cell {
  /** Null for a gridBefore/gridAfter filler. */
  tc: Element | null;
  col: number;
  span: number;
  rowSpan: number;
}

interface Row {
  tr: Element;
  cells: Cell[];
  /** First and past-the-last grid column of the row's real cells. */
  start: number;
  end: number;
}

interface TableInfo {
  ctx: RenderContext;
  chain: TableStyleNode[];
  /** Table-level property sources, lowest precedence first. */
  tblPrs: Array<Element | null>;
  /** The style's whole-table layers, lowest precedence first. */
  whole: TableCondition[];
  look: Look;
  rowBand: number;
  colBand: number;
  rowCount: number;
}

/** The highest-precedence (last) source that `read` finds something in. */
function pick<T>(sources: Array<Element | null>, read: (el: Element) => T | null): T | null {
  return sources.reduceRight<T | null>((found, el) => found ?? (el === null ? null : read(el)), null);
}

function firstKid(el: Element | null, names: string[]): Element | null {
  return names.map((name) => kid(el, name)).find((child) => child !== null) ?? null;
}

function spanOf(value: string | null, min: number): number {
  const n = num(value);

  return n === null ? min : Math.min(MAX_SPAN, Math.max(min, Math.floor(n)));
}

/** Children named `name`, looking through sdt and customXml wrappers. */
function unwrap(parent: Element, name: string, depth = 0): Element[] {
  return kids(parent).flatMap((child) => {
    if (child.localName === name) {
      return [child];
    }
    if (depth >= MAX_UNWRAP) {
      return [];
    }
    if (child.localName === 'customXml') {
      return unwrap(child, name, depth + 1);
    }
    const content = child.localName === 'sdt' ? kid(child, 'sdtContent') : null;

    return content === null ? [] : unwrap(content, name, depth + 1);
  });
}

/** A `w:tblW`/`w:tcW`/`w:tblInd` as a CSS length; null for auto and nil. */
function widthCss(el: Element | null): string | null {
  const type = attr(el, 'type') ?? 'dxa';
  const w = attr(el, 'w');
  if (el === null || w === null) {
    return null;
  }
  if (type === 'dxa') {
    return twips(w);
  }
  if (type !== 'pct') {
    return null;
  }
  const percent = w.endsWith('%') ? num(w.slice(0, -1)) : num(w);
  if (percent === null) {
    return null;
  }

  return `${round(w.endsWith('%') ? percent : percent / 50)}%`;
}

function readLook(el: Element | null): Look {
  const bits = Number.parseInt(attr(el, 'val') ?? '0', 16) || 0;
  // Word 2010+ writes both; the attribute wins over its hex bit.
  const flag = (name: string, bit: number): boolean => {
    const value = attr(el, name);

    return value === null ? (bits & bit) !== 0 : ON.has(value);
  };

  return {
    firstRow: flag('firstRow', 0x0020),
    lastRow: flag('lastRow', 0x0040),
    firstColumn: flag('firstColumn', 0x0080),
    lastColumn: flag('lastColumn', 0x0100),
    noHBand: flag('noHBand', 0x0200),
    noVBand: flag('noVBand', 0x0400),
  };
}

/** Place one cell at grid column `col`; returns the next free column. */
function placeCell(tc: Element, col: number, cells: Cell[], open: Map<number, Cell>): number {
  const tcPr = kid(tc, 'tcPr');
  const span = spanOf(val(tcPr, 'gridSpan'), 1);
  const vMerge = kid(tcPr, 'vMerge');
  const mode = vMerge === null ? null : attr(vMerge, 'val') ?? 'continue';
  const above = open.get(col);
  if (mode === 'continue' && above !== undefined) {
    above.rowSpan += 1;

    return col + span;
  }
  const cell: Cell = { tc, col, span, rowSpan: 1 };
  cells.push(cell);
  if (mode === 'restart') {
    open.set(col, cell);
  } else {
    open.delete(col);
  }

  return col + span;
}

/** Lay rows out on the grid: vMerge continuations grow the cell above instead of rendering. */
function buildRows(trs: Element[]): Row[] {
  const open = new Map<number, Cell>();

  return trs.map((tr) => {
    const trPr = kid(tr, 'trPr');
    const before = spanOf(val(trPr, 'gridBefore'), 0);
    const after = spanOf(val(trPr, 'gridAfter'), 0);
    const cells: Cell[] = before > 0 ? [{ tc: null, col: 0, span: before, rowSpan: 1 }] : [];
    const end = unwrap(tr, 'tc').reduce((col, tc) => placeCell(tc, col, cells, open), before);
    if (after > 0) {
      cells.push({ tc: null, col: end, span: after, rowSpan: 1 });
    }

    return { tr, cells, start: before, end };
  });
}

function bandSize(tblPrs: Array<Element | null>, name: string): number {
  return Math.max(1, Math.floor(pick(tblPrs, (tblPr) => num(val(tblPr, name))) ?? 1));
}

/** Conditional formats that apply to a cell, lowest precedence first. */
function conditionNames(cell: Cell, row: Row, r: number, info: TableInfo): string[] {
  const { look } = info;
  const names: string[] = [];
  const col = cell.col - row.start - (look.firstColumn ? 1 : 0);
  if (!look.noVBand && col >= 0) {
    names.push(Math.floor(col / info.colBand) % 2 === 0 ? 'band1Vert' : 'band2Vert');
  }
  // Banding counts rows after the header row; the last row is banded too.
  const band = r - (look.firstRow ? 1 : 0);
  if (!look.noHBand && band >= 0) {
    names.push(Math.floor(band / info.rowBand) % 2 === 0 ? 'band1Horz' : 'band2Horz');
  }
  if (look.firstColumn && cell.col === row.start) {
    names.push('firstCol');
  }
  if (look.lastColumn && cell.col + cell.span === row.end) {
    names.push('lastCol');
  }
  if (look.firstRow && r === 0) {
    names.push('firstRow');
  }
  if (look.lastRow && r + cell.rowSpan === info.rowCount) {
    names.push('lastRow');
  }

  return names;
}

function edgeBorder(side: Side, outer: boolean, tcPrs: Array<Element | null>, info: TableInfo): string {
  const inside = side === 'top' || side === 'bottom' ? 'insideH' : 'insideV';
  const direct = tcPrs[tcPrs.length - 1];
  const conditional = tcPrs.slice(0, -1);
  const found = firstKid(kid(direct, 'tcBorders'), SIDE_NAMES[side])
    ?? pick(conditional, (tcPr) => firstKid(kid(tcPr, 'tcBorders'), outer ? SIDE_NAMES[side] : [inside, ...SIDE_NAMES[side]]))
    ?? pick(info.tblPrs, (tblPr) => firstKid(kid(tblPr, 'tblBorders'), outer ? SIDE_NAMES[side] : [inside]));

  return found === null ? 'none' : borderCss(found);
}

function margin(side: Side, tcPrs: Array<Element | null>, info: TableInfo): string {
  const read = (box: Element | null): string | null => {
    const el = firstKid(box, SIDE_NAMES[side]);

    return el === null || (attr(el, 'type') ?? 'dxa') !== 'dxa' ? null : twips(attr(el, 'w'));
  };

  return pick(tcPrs, (tcPr) => read(kid(tcPr, 'tcMar')))
    ?? pick(info.tblPrs, (tblPr) => read(kid(tblPr, 'tblCellMar')))
    ?? `${round(DEFAULT_MARGIN[side] / 20)}pt`;
}

function fillerCell(cell: Cell): HTMLTableCellElement {
  const td = document.createElement('td');
  td.colSpan = cell.span;
  SIDES.forEach((side) => td.style.setProperty(`border-${side}`, 'none'));

  return td;
}

function renderCell(cell: Cell, tc: Element, row: Row, r: number, info: TableInfo): HTMLTableCellElement {
  const { ctx } = info;
  const conditions = conditionNames(cell, row, r, info)
    .flatMap((name) => info.chain.map((node) => node.conditions.get(name)))
    .filter((cond): cond is TableCondition => cond !== undefined);
  const layers = [...info.whole, ...conditions];
  const tcPr = kid(tc, 'tcPr');
  const tcPrs = [...layers.map((layer) => layer.tcPr), tcPr];
  const td = document.createElement('td');
  td.colSpan = cell.span;
  td.rowSpan = cell.rowSpan;

  const outer: Record<Side, boolean> = {
    top: r === 0,
    bottom: r + cell.rowSpan === info.rowCount,
    left: cell.col === row.start,
    right: cell.col + cell.span === row.end,
  };
  SIDES.forEach((side) => {
    td.style.setProperty(`border-${side}`, edgeBorder(side, outer[side], tcPrs, info));
    td.style.setProperty(`padding-${side}`, margin(side, tcPrs, info));
  });
  const width = widthCss(kid(tcPr, 'tcW'));
  if (width !== null) {
    td.style.setProperty('width', width);
  }
  const background = pick(tcPrs, (el) => shading(kid(el, 'shd'))) ?? pick(info.tblPrs, (el) => shading(kid(el, 'shd')));
  if (background !== null) {
    td.style.setProperty('background-color', background);
  }
  td.style.setProperty('vertical-align', pick(tcPrs, (el) => VALIGN[val(el, 'vAlign') ?? ''] ?? null) ?? 'top');

  const layer = {
    para: mergePara(...layers.map((cond) => parseParaProps(cond.pPr))),
    run: mergeCss(...layers.map((cond) => parseRunProps(cond.rPr, ctx.styles.theme))),
  };
  td.append(...ctx.blocks(tc, nested(ctx, { layer })));

  return td;
}

function renderRow(row: Row, r: number, info: TableInfo): HTMLTableRowElement {
  const el = document.createElement('tr');
  const height = twips(val(kid(row.tr, 'trPr'), 'trHeight'));
  if (height !== null) {
    el.style.setProperty('height', height);
  }
  row.cells.forEach((cell) => el.append(cell.tc === null ? fillerCell(cell) : renderCell(cell, cell.tc, row, r, info)));

  return el;
}

function styleTable(table: HTMLTableElement, tbl: Element, tblPrs: Array<Element | null>): void {
  table.style.setProperty('border-collapse', 'collapse');
  const width = pick(tblPrs, (el) => widthCss(kid(el, 'tblW')));
  if (width !== null) {
    table.style.setProperty('width', width);
  }
  if (pick(tblPrs, (el) => attr(kid(el, 'tblLayout'), 'type')) === 'fixed') {
    table.style.setProperty('table-layout', 'fixed');
  }
  const indent = pick(tblPrs, (el) => widthCss(kid(el, 'tblInd')));
  const jc = pick(tblPrs, (el) => val(el, 'jc'));
  if (jc === 'center' || jc === 'right' || jc === 'end') {
    table.style.setProperty('margin-left', 'auto');
  } else if (indent !== null) {
    table.style.setProperty('margin-left', indent);
  }
  if (jc === 'center') {
    table.style.setProperty('margin-right', 'auto');
  }

  const cols = kids(kid(tbl, 'tblGrid') ?? tbl, 'gridCol');
  if (cols.length > 0) {
    const group = document.createElement('colgroup');
    cols.forEach((gridCol) => {
      const col = document.createElement('col');
      const w = twips(attr(gridCol, 'w'));
      if (w !== null) {
        col.style.setProperty('width', w);
      }
      group.append(col);
    });
    table.append(group);
  }
}

/** Render a `w:tbl`. */
export function renderTable(tbl: Element, ctx: RenderContext): HTMLElement {
  const tblPr = kid(tbl, 'tblPr');
  const chain = ctx.styles.table(val(tblPr, 'tblStyle'));
  const whole = chain.flatMap((node) => [node, node.conditions.get('wholeTable')])
    .filter((cond): cond is TableCondition => cond !== undefined);
  const tblPrs = [...whole.map((cond) => cond.tblPr), tblPr];
  const trs = unwrap(tbl, 'tr').filter((tr) => kid(kid(tr, 'trPr'), 'del') === null);
  const rows = buildRows(trs);
  const info: TableInfo = {
    ctx,
    chain,
    tblPrs,
    whole,
    look: readLook(kid(tblPr, 'tblLook')),
    rowBand: bandSize(tblPrs, 'tblStyleRowBandSize'),
    colBand: bandSize(tblPrs, 'tblStyleColBandSize'),
    rowCount: rows.length,
  };

  const table = document.createElement('table');
  styleTable(table, tbl, tblPrs);
  const body = document.createElement('tbody');
  rows.forEach((row, r) => body.append(renderRow(row, r, info)));
  table.append(body);

  return table;
}
