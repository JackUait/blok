import type { BlokModules } from '../../../../types-internal/blok-modules';
import { parseClipboardHtml } from '../../../../tools/table/table-cell-clipboard';
import { serializeCellBlocksToHtml } from '../../../../tools/table/table-cell-paste';
import type { CellContent, ClipboardBlockData, LegacyCellContent, TableCellsClipboard, TableClipboardCell } from '../../../../tools/table/types';
import type { SanitizerConfigBuilder } from '../sanitizer-config';
import type { ToolRegistry } from '../tool-registry';
import type { HandlerContext } from '../types';

import type { PasteHandler } from './base';
import { BasePasteHandler } from './base';

/**
 * Clamp a payload cell's spans to the payload bounds (malformed payloads must
 * not produce merges reaching outside the created table).
 */
const clampSpans = (
  cell: TableClipboardCell,
  row: number,
  col: number,
  payload: TableCellsClipboard,
): { colspan: number; rowspan: number } => ({
  colspan: Math.min(cell.colspan ?? 1, payload.cols - col),
  rowspan: Math.min(cell.rowspan ?? 1, payload.rows - row),
});

/**
 * Whether a payload block survives the HTML `text` channel losslessly:
 * paragraphs and list items (which serializeCellBlocksToHtml round-trips) that
 * carry no tunes. Everything else needs the structured `blockData` seed.
 */
const isTextSerializable = (block: ClipboardBlockData): boolean =>
  (block.tool === 'paragraph' || block.tool === 'list')
  && typeof block.data.text === 'string'
  && block.tunes === undefined;

/**
 * Map every position covered by a payload merge footprint (excluding origins)
 * to its origin coordinate. Legacy payloads without spans yield an empty map.
 */
const collectCoveredSlots = (payload: TableCellsClipboard): Map<string, [number, number]> => {
  const covered = new Map<string, [number, number]>();

  const markFootprint = (row: number, col: number, rowspan: number, colspan: number): void => {
    Array.from({ length: rowspan }).forEach((_, dr) => {
      Array.from({ length: colspan }).forEach((__, dc) => {
        if (dr === 0 && dc === 0) {
          return;
        }

        covered.set(`${row + dr}:${col + dc}`, [row, col]);
      });
    });
  };

  payload.cells.forEach((rowCells, r) => {
    rowCells.forEach((cell, c) => {
      const { colspan, rowspan } = clampSpans(cell, r, c, payload);

      if (colspan > 1 || rowspan > 1) {
        markFootprint(r, c, rowspan, colspan);
      }
    });
  });

  return covered;
};

/**
 * Handles pasting table cell clipboard data outside of a table.
 * Creates a new Table block with the pasted cell content.
 * Priority 90: higher than HTML (40) but lower than BlokData (100).
 */
export class TableCellsHandler extends BasePasteHandler implements PasteHandler {
  constructor(
    Blok: BlokModules,
    toolRegistry: ToolRegistry,
    sanitizerBuilder: SanitizerConfigBuilder,
  ) {
    super(Blok, toolRegistry, sanitizerBuilder);
  }

  canHandle(data: unknown): number {
    if (typeof data !== 'string') {
      return 0;
    }

    return parseClipboardHtml(data) !== null ? 90 : 0;
  }

  async handle(data: unknown, context: HandlerContext): Promise<boolean> {
    if (typeof data !== 'string') {
      return false;
    }

    const payload = parseClipboardHtml(data);

    if (!payload) {
      return false;
    }

    // If cursor is inside a table cell, let the grid paste listener handle it.
    // Also bail when focus was lost (e.g. due to a React re-render) but the
    // current block's holder is still inside a table-cell-blocks container —
    // the paste was intended for the table, not for creating a new one.
    // Additionally, bail when the paste event's original target was inside a
    // table cell, even if document.activeElement is now body (covers the case
    // where the event fired on the cell-blocks container itself).
    const activeElement = document.activeElement as HTMLElement | null;

    if (
      activeElement?.closest('[data-blok-table-cell]') ||
      context.currentBlock?.holder?.closest('[data-blok-table-cell-blocks]') ||
      context.pasteTarget?.closest('[data-blok-table-cell]')
    ) {
      return false;
    }

    const { BlockManager, Caret } = this.Blok;

    // Build table content from the clipboard payload.
    // Merge origins become CellContent with colspan/rowspan and their covered
    // footprint gets mergedInto, so a copied merged region survives the paste.
    // When a cell has color or textColor, use a CellContent object to preserve
    // the colors — the Table tool will create paragraph blocks during its
    // rendered() lifecycle. For plain cells, store text strings which the
    // Table tool migrates to blocks normally. Legacy payloads without spans
    // (covered flags only) fall back to a flat grid.
    const coveredSlots = collectCoveredSlots(payload);

    const content: LegacyCellContent[][] = payload.cells.map((row, r) =>
      row.map((cell, c) => this.buildCellContent(cell, r, c, payload, coveredSlots)),
    );

    const tableData = {
      withHeadings: false,
      withHeadingColumn: false,
      content,
    };

    const canReplace = context.canReplaceCurrentBlock;
    const block = BlockManager.insert({
      tool: 'table',
      data: tableData,
      replace: canReplace,
    });

    Caret.setToBlock(block, Caret.positions.END);

    return true;
  }

  /**
   * Convert one clipboard cell to TableData content: mergedInto for covered
   * merge slots, CellContent for origins with spans/colors/placement/structured
   * blocks, plain text strings otherwise.
   */
  private buildCellContent(
    cell: TableClipboardCell,
    row: number,
    col: number,
    payload: TableCellsClipboard,
    coveredSlots: Map<string, [number, number]>,
  ): LegacyCellContent {
    const origin = coveredSlots.get(`${row}:${col}`);

    if (origin !== undefined) {
      return { blocks: [], mergedInto: origin };
    }

    // Serialize blocks structurally (lists → <ul>/<ol> markup) so the Table
    // tool's cell parser reconstructs them as list blocks instead of the
    // text join flattening them to a single line.
    const text = serializeCellBlocksToHtml(cell.blocks);

    const { colspan, rowspan } = clampSpans(cell, row, col, payload);
    const hasColor = cell.color !== undefined;
    const hasTextColor = cell.textColor !== undefined;
    const hasPlacement = cell.placement !== undefined;
    // Blocks the text channel cannot carry (image/code/embed) or that carry
    // tunes must be seeded structurally — rebuilding them from `text` dropped
    // them, so a copied range pasted outside a table lost its images.
    const needsStructuredBlocks = cell.blocks.some(block => !isTextSerializable(block));

    if (!hasColor && !hasTextColor && !hasPlacement && !needsStructuredBlocks && colspan <= 1 && rowspan <= 1) {
      return text;
    }

    const cellContent: CellContent = { blocks: [], text };

    if (needsStructuredBlocks) {
      cellContent.blockData = cell.blocks;
    }

    if (hasColor) {
      cellContent.color = cell.color;
    }

    if (hasTextColor) {
      cellContent.textColor = cell.textColor;
    }

    if (hasPlacement) {
      cellContent.placement = cell.placement;
    }

    if (colspan > 1) {
      cellContent.colspan = colspan;
    }

    if (rowspan > 1) {
      cellContent.rowspan = rowspan;
    }

    return cellContent;
  }
}
