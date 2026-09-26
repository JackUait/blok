import { repairMergeGrid } from '../shared/table-merge-repair';
import type { MergeRepairCell } from '../shared/table-merge-repair';

interface ViewCell extends MergeRepairCell {
  source: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const spanOf = (value: unknown): number | undefined => {
  const span = Number(value);

  return Number.isInteger(span) && span > 1 ? span : undefined;
};

const toViewCell = (cell: unknown): ViewCell => {
  if (!isRecord(cell)) {
    return { blocks: [], source: cell };
  }

  const view: ViewCell = {
    blocks: Array.isArray(cell.blocks) ? cell.blocks.filter((id): id is string => typeof id === 'string') : [],
    source: cell,
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

const fromViewCell = ({ source, blocks, colspan, rowspan, mergedInto }: ViewCell): unknown => {
  if (!isRecord(source) && mergedInto === undefined) {
    return source;
  }

  const { colspan: _c, rowspan: _r, mergedInto: _m, ...rest } = isRecord(source) ? source : {};

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

/**
 * The inline HTML a cell renders from its own text: a string cell, or a
 * record with no block ids (ids win over `text`, as in the editor).
 */
const legacyText = (source: unknown, blocks: string[]): string | undefined => {
  const own = isRecord(source) && blocks.length === 0 ? source.text : undefined;
  const text = typeof source === 'string' ? source : own;

  return typeof text === 'string' && text !== '' ? text : undefined;
};

/**
 * A table block's rows with its merges repaired the way the editor repairs
 * them on load, so a malformed saved table renders the same everywhere.
 * Legacy string cells pass through; one a live span claims renders in its
 * origin, via {@link claimedCellTexts}.
 * @param content - the table block's raw `data.content`
 */
export const repairedTableRows = (content: unknown): unknown[][] => {
  const rows = Array.isArray(content) ? content.filter((row): row is unknown[] => Array.isArray(row)) : [];
  const input = rows.map(row => row.map(toViewCell));
  const repaired = repairMergeGrid(input);
  const out = repaired.map(row => row.map(fromViewCell));

  // A claimed cell that did not itself say `mergedInto` is content, not a
  // stale cover: the editor migrates a string cell to blocks the repair moves
  // into the origin, so its text shows there. A declared cover's text stays
  // hidden. Origins are always records (only a record has a span), so the
  // origin's output is a fresh object.
  repaired.forEach((row, r) => row.forEach((cell, c) => {
    const text = legacyText(cell.source, input[r][c].blocks);
    const origin = cell.mergedInto === undefined ? undefined : out[cell.mergedInto[0]][cell.mergedInto[1]];

    if (text === undefined || input[r][c].mergedInto !== undefined || !isRecord(origin)) {
      return;
    }

    claimedTexts.set(origin, [...(claimedTexts.get(origin) ?? []), text]);
  }));

  return out;
};

/**
 * Inline HTML of the legacy cells a live span claimed into this origin, in
 * row-major order; rendered after the origin's own content.
 * @param cell - a cell from {@link repairedTableRows}
 */
export const claimedCellTexts = (cell: unknown): string[] => (isRecord(cell) ? claimedTexts.get(cell) ?? [] : []);
