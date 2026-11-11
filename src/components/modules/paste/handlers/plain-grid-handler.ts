import { nanoid } from 'nanoid';

import { parsePlainTextGrid } from '../../../../tools/table/table-cell-clipboard';
import { isChildToolAllowed } from '../../../utils/child-tools';
import { offerCsvDatabase } from '../csv-database-offer';
import type { HandlerContext } from '../types';

import type { PasteHandler } from './base';
import { BasePasteHandler } from './base';
import { isTableCellPaste, tableDataFromClipboard } from './table-cells-handler';

/**
 * Plain text gives one block per line, a table one per cell. This cap keeps a
 * forged clipboard from turning a short text into a huge table.
 */
const MAX_GRID_CELLS = 10_000;

/** The grid's size, or null when the text is not a clean grid. */
const gridSize = (text: string): { rows: number; cols: number } | null => {
  const lines = text.replace(/\r?\n$/, '').split(/\r?\n/);
  const cols = lines[0].split('\t').length;

  if (lines.length < 2 || cols < 2 || lines.some(line => line.split('\t').length !== cols)) {
    return null;
  }

  // Every line opening with a tab is indented code, not a grid with an empty first column.
  return lines.every(line => line.startsWith('\t')) ? null : { rows: lines.length, cols };
};

/**
 * Plain tab-separated text (a spreadsheet or terminal copy with no HTML) pastes
 * as a table, like the same paste inside a table. Runs before Markdown, so a
 * `#` in a cell stays text. Only lines with the same tab count of 2+ columns
 * count, so tab-indented code and Makefiles stay text.
 */
export class PlainGridHandler extends BasePasteHandler implements PasteHandler {
  canHandle(data: unknown): number {
    if (typeof data !== 'string' || !this.Blok.Tools.blockTools.has('table')) {
      return 0;
    }

    const size = gridSize(data);

    return size !== null && size.rows * size.cols <= MAX_GRID_CELLS ? 35 : 0;
  }

  async handle(data: unknown, context: HandlerContext): Promise<boolean> {
    const { BlockManager, Caret } = this.Blok;
    const current = BlockManager.currentBlock;
    const parent = current?.parentId == null ? null : BlockManager.getBlockById(current.parentId);

    if (typeof data !== 'string' || isTableCellPaste(context) || !isChildToolAllowed(parent, 'table')) {
      return false;
    }

    const payload = parsePlainTextGrid(data);

    if (payload === null) {
      return false;
    }

    const block = BlockManager.insert({
      tool: 'table',
      data: tableDataFromClipboard(payload),
      replace: context.canReplaceCurrentBlock,
      origin: 'paste',
    });

    Caret.setToBlock(block, Caret.positions.END);

    const tools = this.Blok.Tools.blockTools;

    if (tools.has('database') && tools.has('database-row')) {
      offerCsvDatabase(data, [block.id], {
        blocks: this.Blok.BlocksAPI.methods,
        notify: (options) => this.Blok.NotifierAPI.methods.show(options),
        t: (key) => this.Blok.I18n.t(key),
        newId: () => nanoid(),
      }, true);
    }

    return true;
  }
}
