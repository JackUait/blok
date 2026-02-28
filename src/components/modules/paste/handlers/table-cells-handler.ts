import type { BlokModules } from '../../../../types-internal/blok-modules';
import { parseClipboardHtml } from '../../../../tools/table/table-cell-clipboard';
import type { CellContent, LegacyCellContent } from '../../../../tools/table/types';
import type { SanitizerConfigBuilder } from '../sanitizer-config';
import type { ToolRegistry } from '../tool-registry';
import type { HandlerContext } from '../types';

import type { PasteHandler } from './base';
import { BasePasteHandler } from './base';

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

    // If cursor is inside a table cell, let the grid paste listener handle it
    const activeElement = document.activeElement as HTMLElement | null;

    if (activeElement?.closest('[data-blok-table-cell]')) {
      return false;
    }

    const { BlockManager, Caret } = this.Blok;

    // Build table content from the clipboard payload.
    // When a cell has color or textColor, use a CellContent object to preserve
    // the colors — the Table tool will create paragraph blocks during its
    // rendered() lifecycle. For cells without colors, store plain text strings
    // which the Table tool migrates to blocks normally.
    const content: LegacyCellContent[][] = payload.cells.map(row =>
      row.map(cell => {
        const text = cell.blocks.length === 0
          ? ''
          : cell.blocks
            .map(b => (typeof b.data.text === 'string' ? b.data.text : ''))
            .join(' ');

        const hasColor = cell.color !== undefined;
        const hasTextColor = cell.textColor !== undefined;

        if (!hasColor && !hasTextColor) {
          return text;
        }

        const cellContent: CellContent = { blocks: [], text };

        if (hasColor) {
          cellContent.color = cell.color;
        }

        if (hasTextColor) {
          cellContent.textColor = cell.textColor;
        }

        return cellContent;
      }),
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
}
