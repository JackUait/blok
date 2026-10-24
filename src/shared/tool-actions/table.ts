import { isSafeCssColor } from '../css-color';
import { mintId } from '../mint-id';
import { insertedColumnWidth } from '../table/column-widths';
import { alignRowsToColumns, ensureTableIdsWith } from '../table/table-ids';
import { TableModel } from '../table/table-model';
import { isCellWithBlocks } from '../table/types';

import type { BlockPosition } from '../../../types/api/blocks';
import type { RichText } from '../../../types/rich-text';
import type { ToolActionContext, ToolActionImpl } from '../../../types/tools/tool-description';
import type { SelectionRect } from '../table/table-model';
import type { CellContent, CellPlacement } from '../table/types';

const isObjectRow = (row: unknown): row is CellContent[] =>
  Array.isArray(row) && row.every(isCellWithBlocks);

export const normalizeTable = (
  data: Record<string, unknown>,
  mint: () => string = () => mintId(10),
): Record<string, unknown> => {
  if (!Array.isArray(data.content)) {
    return data;
  }

  const rows: unknown[] = data.content;
  const objectRows = rows.filter(isObjectRow);
  const aligned = alignRowsToColumns(objectRows).map((row, index) => {
    const originals = new Set(objectRows[index]);
    // Only leading and interior gaps may be filled.
    const end = row.reduce((last, cell, column) => originals.has(cell) ? column + 1 : last, 0);

    return row.slice(0, end);
  });
  const fixed = ensureTableIdsWith(aligned, mint).values();

  return { ...data, content: rows.map(row => (isObjectRow(row) ? fixed.next().value ?? row : row)) };
};

type TargetBlock = NonNullable<ToolActionContext['block']>;

export interface CellRange {
  fromRow: number;
  fromCol: number;
  toRow: number;
  toCol: number;
}

export const rectOf = (range: CellRange): SelectionRect => ({
  minRow: Math.min(range.fromRow, range.toRow),
  maxRow: Math.max(range.fromRow, range.toRow),
  minCol: Math.min(range.fromCol, range.toCol),
  maxCol: Math.max(range.fromCol, range.toCol),
});

export const assertInTable = (ctx: ToolActionContext, model: TableModel, rect: SelectionRect): void => {
  if (rect.maxRow >= model.rows || rect.maxCol >= model.cols) {
    ctx.fail('PRECONDITION_FAILED', `The table is ${model.rows} rows x ${model.cols} columns; indices start at 0.`);
  }
};

// The Jint realm has no structuredClone; block data is JSON.
const jsonCopy = (value: unknown): Record<string, unknown> =>
  JSON.parse(JSON.stringify(value ?? {})) as Record<string, unknown>;

export const copyBlockTree = (ctx: ToolActionContext, sourceId: string, parentId: string, position?: BlockPosition): string => {
  const source = ctx.read(sourceId) ?? ctx.fail('PRECONDITION_FAILED', `Block ${sourceId} does not exist.`);
  const id = ctx.insert({ type: source.type, data: jsonCopy(source.data), parentId, position, copy: true });

  source.children.forEach(child => copyBlockTree(ctx, child, id));

  return id;
};

const indices = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** Every [row, col] of a rectangle, row by row. */
const cellsIn = (rect: SelectionRect): Array<[number, number]> =>
  indices(rect.minRow, rect.maxRow).flatMap(row => indices(rect.minCol, rect.maxCol).map((col): [number, number] => [row, col]));

// Same key storedCellTexts uses: a cell's row and column ids.
const cellKey = (model: TableModel, row: number, col: number): string => {
  const cell = model.snapshot().content[row]?.[col];

  return isCellWithBlocks(cell) ? JSON.stringify([cell.rowId, cell.id]) : '';
};

export const tableTarget = (ctx: ToolActionContext): TargetBlock =>
  ctx.block ?? ctx.fail('INVALID_ARGS', 'Pass the id of a table block.');

export const tableModel = (ctx: ToolActionContext, block: TargetBlock): TableModel =>
  new TableModel(block.data, { mintId: () => ctx.newId() });

const storedCellTexts = (block: TargetBlock, model: TableModel): ReadonlyMap<string, string> => {
  const content: unknown[] = Array.isArray(block.data.content) ? block.data.content : [];
  const rows = content.map((row): unknown[] => Array.isArray(row) ? row : []);
  const aligned = alignRowsToColumns(rows.map(row => isObjectRow(row) ? row : []));
  const initial = model.snapshot().content;

  // The model drops legacy text; cell ids keep it attached across insertions.
  return new Map(rows.flatMap((row, r) =>
    (isObjectRow(row) ? aligned[r] : row).flatMap((source, c): Array<[string, string]> => {
      const text = typeof source === 'object' && source !== null && 'text' in source ? source.text : source;
      const cell = initial[r]?.[c];

      if (typeof text !== 'string' || cell === undefined || !isCellWithBlocks(cell)) {
        return [];
      }

      return [[JSON.stringify([cell.rowId, cell.id]), text]];
    })
  ));
};

export const commitTable = (
  ctx: ToolActionContext,
  id: string,
  model: TableModel,
  texts?: ReadonlyMap<string, string>,
): void => {
  const { content, colWidths } = model.snapshot();
  const preserved = content.map(row => row.map(cell => {
    if (!isCellWithBlocks(cell)) {
      return cell;
    }
    const text = texts?.get(JSON.stringify([cell.rowId, cell.id]));

    return text === undefined ? cell : { ...cell, text };
  }));

  ctx.update(id, colWidths === undefined ? { content: preserved } : { content: preserved, colWidths });
};

/**
 * Where a new block of cell (row, col) goes among the table's children: right after the last
 * block of that cell or the nearest earlier one, else first. The editor keeps the table's
 * children in grid order (indexForCell, reorderChildrenToGrid in src/tools/table); keyboard
 * moves, drag and reload read that order.
 */
const cellSlot = (ctx: ToolActionContext, model: TableModel, row: number, col: number): BlockPosition => {
  const upTo = indices(0, row).flatMap(r => indices(0, r === row ? col : model.cols - 1).map((c): [number, number] => [r, c]));
  const anchor = upTo.reverse()
    .flatMap(([r, c]) => model.getCellBlocks(r, c).reverse())
    .find(id => ctx.read(id) !== null);

  return anchor === undefined ? 'start' : { after: anchor };
};

export const seedCell = (
  ctx: ToolActionContext,
  tableId: string,
  model: TableModel,
  row: number,
  col: number,
  text: RichText | string = [],
): string => {
  const id = ctx.insert({ type: 'paragraph', data: { text }, parentId: tableId, position: cellSlot(ctx, model, row, col) });

  model.addBlockToCell(row, col, id);

  return id;
};

interface CreateArgs {
  rows: number;
  cols: number;
  withHeadings?: boolean;
  withHeadingColumn?: boolean;
  cells?: Array<Array<RichText | string>>;
  parentId?: string | null;
  position?: BlockPosition;
}

const create: ToolActionImpl<CreateArgs, undefined, { id: string; childIds: string[] }> = {
  run: (ctx, args) => {
    const columnIds = Array.from({ length: args.cols }, () => ctx.newId());
    const cells = Array.from({ length: args.rows }, (_, row) => {
      const rowId = ctx.newId();

      return columnIds.map((columnId, col) => ({ blockId: ctx.newId(), id: columnId, rowId, text: args.cells?.[row]?.[col] ?? [] }));
    });
    // One insert with the whole grid: an editor table rendered with empty content seeds a
    // default 3x3 grid of its own, whose blocks no later content write references.
    const id = ctx.insert({
      // The host's registry key, not 'table'.
      type: ctx.tool,
      data: {
        withHeadings: args.withHeadings ?? false,
        withHeadingColumn: args.withHeadingColumn ?? false,
        content: cells.map(row => row.map(cell => ({ blocks: [cell.blockId], id: cell.id, rowId: cell.rowId }))),
      },
      children: cells.flat().map(cell => ({ id: cell.blockId, type: 'paragraph', data: { text: cell.text } })),
      parentId: args.parentId,
      position: args.position,
    });

    return { id, childIds: cells.flat().map(cell => cell.blockId) };
  },
};

interface InsertArgs {
  at: number;
  count?: number;
  cells?: Array<Array<RichText | string>>;
}

const insertRows: ToolActionImpl<InsertArgs, undefined, { childIds: string[] }> = {
  run: (ctx, args) => {
    const block = tableTarget(ctx);
    const model = tableModel(ctx, block);
    const texts = storedCellTexts(block, model);
    const at = Math.min(args.at, model.rows);
    const childIds: string[] = [];

    for (const i of Array.from({ length: args.count ?? 1 }, (_, index) => index)) {
      const row = at + i;

      model.addRow(row);
      const columns = Array.from({ length: model.cols }, (_, col) => col)
        .filter(col => !model.isSpannedCell(row, col));

      for (const col of columns) {
        childIds.push(seedCell(ctx, block.id, model, row, col, args.cells?.[i]?.[col] ?? []));
      }
    }
    commitTable(ctx, block.id, model, texts);

    return { childIds };
  },
};

const insertColumns: ToolActionImpl<InsertArgs, undefined, { childIds: string[] }> = {
  run: (ctx, args) => {
    const block = tableTarget(ctx);
    const model = tableModel(ctx, block);
    const texts = storedCellTexts(block, model);
    const at = Math.min(args.at, model.cols);
    const childIds: string[] = [];

    for (const i of Array.from({ length: args.count ?? 1 }, (_, index) => index)) {
      const widths = model.colWidths;
      const { cellsToPopulate } = model.addColumn(at + i,
        widths === undefined ? undefined : insertedColumnWidth(widths, model.initialColWidth));

      for (const cell of cellsToPopulate.filter(cell => !model.isSpannedCell(cell.row, cell.col))) {
        childIds.push(seedCell(ctx, block.id, model, cell.row, cell.col, args.cells?.[i]?.[cell.row] ?? []));
      }
    }
    commitTable(ctx, block.id, model, texts);

    return { childIds };
  },
};

// A cell may name a block that no longer exists; the real context refuses to remove it.
const removeCellBlocks = (ctx: ToolActionContext, ids: string[]): void => {
  ids.filter(id => ctx.read(id) !== null).forEach(id => ctx.remove(id, { withChildren: true }));
};

const openTable = (ctx: ToolActionContext): { block: TargetBlock; model: TableModel; texts: Map<string, string> } => {
  const block = tableTarget(ctx);
  const model = tableModel(ctx, block);

  return { block, model, texts: new Map(storedCellTexts(block, model)) };
};

interface LineArgs {
  at: number;
  count?: number;
}

const lineCount = (model: TableModel, kind: 'row' | 'column'): number => kind === 'row' ? model.rows : model.cols;

const assertLinesInTable = (ctx: ToolActionContext, model: TableModel, kind: 'row' | 'column', args: LineArgs): void => {
  const total = lineCount(model, kind);

  if (args.at + (args.count ?? 1) > total) {
    ctx.fail('PRECONDITION_FAILED', `That ${kind} range runs past the end: the table has ${total} ${kind}s.`);
  }
};

const deleteLines = (kind: 'row' | 'column'): ToolActionImpl<LineArgs> => ({
  run: (ctx, args) => {
    const { block, model, texts } = openTable(ctx);
    const count = args.count ?? 1;

    assertLinesInTable(ctx, model, kind, args);
    if (count >= lineCount(model, kind)) {
      ctx.fail('PRECONDITION_FAILED', `A table keeps at least one ${kind}. Delete the table with block.delete instead.`);
    }

    // Highest index first, so the indices still to delete do not shift.
    for (const index of Array.from({ length: count }, (_, i) => args.at + count - 1 - i)) {
      const { blocksToDelete } = kind === 'row' ? model.deleteRow(index) : model.deleteColumn(index);

      removeCellBlocks(ctx, blocksToDelete);
    }
    commitTable(ctx, block.id, model, texts);

    return undefined;
  },
});

const moveLine = (kind: 'row' | 'column'): ToolActionImpl<{ from: number; to: number }> => ({
  run: (ctx, args) => {
    const { block, model, texts } = openTable(ctx);
    const total = lineCount(model, kind);

    if (args.from >= total || args.to >= total) {
      ctx.fail('PRECONDITION_FAILED', `The table has ${total} ${kind}s; indices start at 0.`);
    }
    if (!(kind === 'row' ? model.canMoveRow(args.from, args.to) : model.canMoveColumn(args.from, args.to))) {
      ctx.fail('PRECONDITION_FAILED', `That ${kind} move would split a merged cell. Split it first with table.splitCell.`);
    }
    if (kind === 'row') {
      model.moveRow(args.from, args.to);
    } else {
      model.moveColumn(args.from, args.to);
    }
    commitTable(ctx, block.id, model, texts);

    return undefined;
  },
});

/** Fills an empty target cell with copies of the source cell's blocks, or its legacy text when it has none. */
const copyCellContent = (
  ctx: ToolActionContext,
  tableId: string,
  model: TableModel,
  texts: Map<string, string>,
  [sourceRow, sourceCol]: [number, number],
  [row, col]: [number, number],
): void => {
  const copies = model.getCellBlocks(sourceRow, sourceCol)
    .filter(id => ctx.read(id) !== null)
    .map((id) => {
      const copy = copyBlockTree(ctx, id, tableId, cellSlot(ctx, model, row, col));

      model.addBlockToCell(row, col, copy);

      return copy;
    });
  const text = texts.get(cellKey(model, sourceRow, sourceCol));

  if (copies.length === 0 && text !== undefined) {
    texts.set(cellKey(model, row, col), text);
  } else if (copies.length === 0) {
    seedCell(ctx, tableId, model, row, col);
  }
};

const duplicateLines = (kind: 'row' | 'column'): ToolActionImpl<LineArgs> => ({
  run: (ctx, args) => {
    const { block, model, texts } = openTable(ctx);
    const count = args.count ?? 1;
    const across = kind === 'row' ? model.cols : model.rows;

    assertLinesInTable(ctx, model, kind, args);
    // Copies go after the whole source range, so source indices never shift.
    for (const i of Array.from({ length: count }, (_, index) => index)) {
      const source = args.at + i;
      const target = args.at + count + i;
      const widths = model.colWidths;

      if (kind === 'row') {
        model.addRow(target);
      } else {
        model.addColumn(target, widths?.[source]);
      }

      const pairs = indices(0, across - 1)
        .map(k => kind === 'row' ? [[source, k], [target, k]] : [[k, source], [k, target]])
        .filter(([, [row, col]]) => !model.isSpannedCell(row, col));

      for (const [[sourceRow, sourceCol], [row, col]] of pairs) {
        copyCellContent(ctx, block.id, model, texts, [sourceRow, sourceCol], [row, col]);
        model.setCellColor(row, col, model.getCellColor(sourceRow, sourceCol));
        model.setCellTextColor(row, col, model.getCellTextColor(sourceRow, sourceCol));
        model.setCellPlacement(row, col, model.getCellPlacement(sourceRow, sourceCol));
      }
    }
    commitTable(ctx, block.id, model, texts);

    return undefined;
  },
});

const clearCells: ToolActionImpl<{ range: CellRange }> = {
  run: (ctx, args) => {
    const { block, model, texts } = openTable(ctx);
    const rect = rectOf(args.range);

    assertInTable(ctx, model, rect);
    for (const [row, col] of cellsIn(rect).filter(([r, c]) => !model.isSpannedCell(r, c))) {
      removeCellBlocks(ctx, model.getCellBlocks(row, col));
      model.setCellBlocks(row, col, []);
      texts.delete(cellKey(model, row, col));
      // Headless there is no mutation handler to re-seed the emptied cell.
      seedCell(ctx, block.id, model, row, col);
    }
    commitTable(ctx, block.id, model, texts);

    return undefined;
  },
};

interface StyleArgs {
  range: CellRange;
  color?: string | null;
  textColor?: string | null;
  placement?: CellPlacement | null;
}

const styleCells: ToolActionImpl<StyleArgs> = {
  run: (ctx, args) => {
    if (args.color === undefined && args.textColor === undefined && args.placement === undefined) {
      ctx.fail('INVALID_ARGS', 'Pass color, textColor or placement (null clears one).');
    }
    // The model silently ignores an unsafe colour; check first so nothing is half-written.
    const refused = [args.color, args.textColor].find(color => typeof color === 'string' && !isSafeCssColor(color));

    if (refused !== undefined) {
      ctx.fail('PRECONDITION_FAILED', `"${refused}" is not a colour the table accepts. Use a preset name or a plain CSS colour.`);
    }
    const { block, model, texts } = openTable(ctx);
    const rect = rectOf(args.range);

    assertInTable(ctx, model, rect);
    for (const [row, col] of cellsIn(rect)) {
      if (args.color !== undefined) {
        model.setCellColor(row, col, args.color ?? undefined);
      }
      if (args.textColor !== undefined) {
        model.setCellTextColor(row, col, args.textColor ?? undefined);
      }
      if (args.placement !== undefined) {
        model.setCellPlacement(row, col, args.placement ?? undefined);
      }
    }
    commitTable(ctx, block.id, model, texts);

    return undefined;
  },
};

const fillCells: ToolActionImpl<{ range: CellRange; direction: 'right' | 'down' }> = {
  run: (ctx, args) => {
    const { block, model, texts } = openTable(ctx);
    const rect = rectOf(args.range);

    assertInTable(ctx, model, rect);
    const right = args.direction === 'right';
    const targets = cellsIn(rect)
      .filter(([row, col]) => (right ? col !== rect.minCol : row !== rect.minRow) && !model.isSpannedCell(row, col));

    for (const [row, col] of targets) {
      const [sourceRow, sourceCol] = right ? [row, rect.minCol] : [rect.minRow, col];
      const origin = model.getMergeOrigin(sourceRow, sourceCol) ?? [sourceRow, sourceCol];

      removeCellBlocks(ctx, model.getCellBlocks(row, col));
      model.setCellBlocks(row, col, []);
      texts.delete(cellKey(model, row, col));
      copyCellContent(ctx, block.id, model, texts, origin, [row, col]);
    }
    commitTable(ctx, block.id, model, texts);

    return undefined;
  },
};

/**
 * After a merge the origin cell lists blocks that sat in later cells. Move each right after
 * the one before it in the cell, as the editor's reorderChildrenToGrid does.
 */
const keepCellBlocksTogether = (ctx: ToolActionContext, tableId: string, model: TableModel, rect: SelectionRect): void => {
  const blocks = model.getCellBlocks(rect.minRow, rect.minCol).filter(id => ctx.read(id) !== null);

  blocks.forEach((id, i) => {
    const prev = blocks[i - 1];
    const order = ctx.read(tableId)?.children ?? [];

    if (prev !== undefined && order[order.indexOf(id) - 1] !== prev) {
      ctx.move(id, { parentId: tableId, position: { after: prev } });
    }
  });
};

// Block ids do not change: the absorbed cells' blocks move into the origin cell's list.
const mergeCells: ToolActionImpl<{ range: CellRange }> = {
  run: (ctx, args) => {
    const { block, model, texts } = openTable(ctx);

    if (!model.canMergeCells(rectOf(args.range))) {
      ctx.fail('PRECONDITION_FAILED', 'These cells cannot merge: pick at least two cells, inside the table, that do not cut through another merged cell.');
    }
    model.mergeCells(rectOf(args.range));
    keepCellBlocksTogether(ctx, block.id, model, rectOf(args.range));
    commitTable(ctx, block.id, model, texts);

    return undefined;
  },
};

const splitCell: ToolActionImpl<{ row: number; col: number }> = {
  run: (ctx, args) => {
    const { block, model, texts } = openTable(ctx);

    if (!model.isMergedCell(args.row, args.col)) {
      ctx.fail('PRECONDITION_FAILED', `Cell ${args.row},${args.col} is not a merged cell. Pass the top-left cell of a merge.`);
    }
    const { colspan, rowspan } = model.getCellSpan(args.row, args.col);

    model.splitCell(args.row, args.col);
    const freed = cellsIn({ minRow: args.row, maxRow: args.row + rowspan - 1, minCol: args.col, maxCol: args.col + colspan - 1 })
      .filter(([row, col]) => model.getCellBlocks(row, col).length === 0 && !texts.has(cellKey(model, row, col)));

    for (const [row, col] of freed) {
      seedCell(ctx, block.id, model, row, col);
    }
    commitTable(ctx, block.id, model, texts);

    return undefined;
  },
};

export const TABLE_ACTION_HANDLERS: Readonly<Record<string, ToolActionImpl>> = {
  create,
  insertRows,
  insertColumns,
  deleteRows: deleteLines('row'),
  deleteColumns: deleteLines('column'),
  moveRow: moveLine('row'),
  moveColumn: moveLine('column'),
  duplicateRows: duplicateLines('row'),
  duplicateColumns: duplicateLines('column'),
  clearCells,
  styleCells,
  fillCells,
  mergeCells,
  splitCell,
};
