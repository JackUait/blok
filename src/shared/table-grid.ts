import { repairMergeGrid } from './table-merge-repair';
import type { MergeRepairCell } from './table-merge-repair';

interface ViewCell extends MergeRepairCell {
  source: unknown;
  sourceIndex?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// The editor's merge repair ignores a non-number span, so "2" must not merge here.
const spanOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value > 1 ? value : undefined;

const toViewCell = (cell: unknown, sourceIndex: number): ViewCell => {
  if (!isRecord(cell)) {
    return { blocks: [], source: cell, sourceIndex };
  }

  const view: ViewCell = {
    blocks: Array.isArray(cell.blocks) ? cell.blocks.filter((id): id is string => typeof id === 'string') : [],
    source: cell,
    sourceIndex,
  };
  const colspan = spanOf(cell.colspan);
  const rowspan = spanOf(cell.rowspan);

  if (colspan !== undefined) {
    view.colspan = colspan;
  }

  if (rowspan !== undefined) {
    view.rowspan = rowspan;
  }

  // Only presence matters: the repair recomputes the origin.
  if (cell.mergedInto !== undefined) {
    view.mergedInto = [0, 0];
  }

  return view;
};

const columnIdsOf = (row: ViewCell[]): string[] | null => {
  const ids = row.map(cell => isRecord(cell.source) ? cell.source.id : undefined);

  return ids.every((id): id is string => typeof id === 'string' && id.length > 0) &&
    new Set(ids).size === ids.length ? ids : null;
};

/** Match the editor's ID alignment before padding and merge repair. */
const alignRowsToColumns = (grid: ViewCell[][]): ViewCell[][] => {
  const canonical = grid.map(columnIdsOf)
    .reduce<string[] | null>((widest, ids) => ids !== null && ids.length > (widest?.length ?? 0) ? ids : widest, null);

  if (canonical === null) {
    return grid;
  }

  const known = new Set(canonical);

  return grid.map(row => {
    const ids = columnIdsOf(row);
    const aligned = ids !== null && ids.length === canonical.length && ids.every((id, index) => id === canonical[index]);

    if (ids === null || aligned || !ids.every(id => known.has(id))) {
      return row;
    }

    const byId = new Map(row.map((cell, index): [string, ViewCell] => [ids[index], cell]));
    const first = row[0]?.source;
    const rowId = isRecord(first) && typeof first.rowId === 'string' ? first.rowId : undefined;

    return canonical.map(id => byId.get(id) ?? {
      blocks: [],
      source: { blocks: [], id, ...(rowId === undefined ? {} : { rowId }) },
    });
  });
};

const fromViewCell = ({ source, blocks, colspan, rowspan, mergedInto }: ViewCell): unknown => {
  if (!isRecord(source) && mergedInto === undefined) {
    return source;
  }

  const { colspan: _c, rowspan: _r, mergedInto: _m, ...rest } = isRecord(source) ? source : {};

  if (isRecord(source) && Array.isArray(source.blocks) && source.blocks.length > 0 && blocks.length === 0) {
    delete rest.text;
  }

  return {
    ...rest,
    blocks,
    ...(colspan !== undefined ? { colspan } : {}),
    ...(rowspan !== undefined ? { rowspan } : {}),
    ...(mergedInto !== undefined ? { mergedInto } : {}),
  };
};

/** Legacy text of cells a live span claimed, by the origin cell's output object. */
const claimedTexts = new WeakMap<Record<string, unknown>, string[]>();
/** Text before blocks moved into a text-only origin. */
const leadingTexts = new WeakMap<Record<string, unknown>, string>();
interface SourceCell {
  index: number;
  column: number;
  shown: unknown;
}

/** Original cells in displayed column order. */
const sourceCells = new WeakMap<unknown[][], SourceCell[][]>();
const syntheticCells = new WeakSet<Record<string, unknown>>();

/**
 * The inline HTML a cell renders from its own text: a string cell, or a
 * record with no block ids (ids win over `text`, as in the editor).
 */
const legacyText = (source: unknown, blocks: unknown[]): string | undefined => {
  const own = isRecord(source) && blocks.length === 0 ? source.text : undefined;
  const text = typeof source === 'string' ? source : own;

  return typeof text === 'string' && text !== '' ? text : undefined;
};

/**
 * The rows of a table's raw content. A null row stays as an empty row, as the
 * editor keeps it; other non-array rows are dropped.
 * @param content - the table block's raw `data.content`
 */
export const tableRows = (content: unknown): unknown[][] => (Array.isArray(content) ? content : [])
  .filter((row): row is unknown[] | null | undefined => Array.isArray(row) || row == null)
  .map(row => row ?? []);

/**
 * A table block's rows with its merges repaired the way the editor repairs
 * them on load, so a malformed saved table renders the same everywhere.
 * Legacy string cells pass through; one a live span claims renders in its
 * origin, via {@link claimedCellTexts}.
 * @param content - the table block's raw `data.content`
 */
export const repairedTableRows = (content: unknown): unknown[][] => {
  const rows = tableRows(content);
  const seenIds = new Set<string>();
  const cells = rows.map(row => row.map((cell, index) => {
    const view = toViewCell(cell, index);

    view.blocks = view.blocks.filter(id => {
      if (seenIds.has(id)) {
        return false;
      }

      seenIds.add(id);

      return true;
    });

    return view;
  }));
  const input = alignRowsToColumns(cells);
  const maxCols = input.reduce((max, row) => Math.max(max, row.length), 0);

  input.forEach(row => {
    while (row.length < maxCols) {
      row.push({ blocks: [], source: { blocks: [] } });
    }
  });

  const repaired = repairMergeGrid(input);
  const out = repaired.map(row => row.map(fromViewCell));
  const bySource: SourceCell[][] = rows.map(() => []);

  // A claimed cell that did not itself say `mergedInto` is content, not a
  // stale cover: the editor migrates a string cell to blocks the repair moves
  // into the origin, so its text shows there. A declared cover's text stays
  // hidden. Origins are always records (only a record has a span), so the
  // origin's output is a fresh object.
  repaired.forEach((row, r) => row.forEach((cell, c) => {
    const ownBlocks = isRecord(cell.source) && Array.isArray(cell.source.blocks) ? cell.source.blocks : [];
    const text = legacyText(cell.source, ownBlocks);
    const shown = out[r][c];

    if (cell.sourceIndex !== undefined) {
      bySource[r].push({ index: cell.sourceIndex, column: c, shown });
    } else if (isRecord(shown)) {
      syntheticCells.add(shown);
    }

    if (cell.mergedInto === undefined && ownBlocks.length === 0 && cell.blocks.length > 0 &&
      text !== undefined && isRecord(shown)) {
      leadingTexts.set(shown, text);
    }

    const origin = cell.mergedInto === undefined ? undefined : out[cell.mergedInto[0]][cell.mergedInto[1]];

    if (text === undefined || input[r][c].mergedInto !== undefined || !isRecord(origin)) {
      return;
    }

    const texts = claimedTexts.get(origin);

    if (texts === undefined) {
      claimedTexts.set(origin, [text]);
    } else {
      texts.push(text);
    }
  }));

  sourceCells.set(out, bySource);

  return out;
};

/**
 * Inline HTML of the legacy cells a live span claimed into this origin, in
 * row-major order; rendered after the origin's own content.
 * @param cell - a cell from {@link repairedTableRows}
 */
export const claimedCellTexts = (cell: unknown): string[] => (isRecord(cell) ? claimedTexts.get(cell) ?? [] : []);

/** Text that precedes blocks moved into a text-only merge origin. */
export const leadingCellText = (cell: unknown): string | undefined =>
  (isRecord(cell) ? leadingTexts.get(cell) : undefined);

/** Original cells in displayed column order after ID alignment. */
export const sourceCellsInDisplayOrder = (rows: unknown[][], row: number): SourceCell[] =>
  sourceCells.get(rows)?.[row] ?? [];

/** A cell inserted only to complete the editor's rectangular grid. */
export const isSyntheticCell = (cell: unknown): boolean => isRecord(cell) && syntheticCells.has(cell);
