import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import { buildClipboardHtml } from '../../../../../src/tools/table/table-cell-clipboard';
import type { TableCellsClipboard } from '../../../../../src/tools/table/types';
import { TableCellsHandler } from '../../../../../src/components/modules/paste/handlers/table-cells-handler';
import type { SanitizerConfigBuilder } from '../../../../../src/components/modules/paste/sanitizer-config';
import type { ToolRegistry } from '../../../../../src/components/modules/paste/tool-registry';
import type { HandlerContext } from '../../../../../src/components/modules/paste/types';

/**
 * Helper: build a clipboard HTML string from a simple 2D text grid.
 */
function buildTableHtml(textGrid: string[][]): string {
  const payload: TableCellsClipboard = {
    rows: textGrid.length,
    cols: textGrid[0]?.length ?? 0,
    cells: textGrid.map(row =>
      row.map(text => ({
        blocks: text ? [{ tool: 'paragraph', data: { text } }] : [],
      }))
    ),
  };

  return buildClipboardHtml(payload);
}

describe('TableCellsHandler', () => {
  const mockBlock = { id: 'inserted-block', name: 'table' };

  let mockBlok: Pick<BlokModules, 'BlockManager' | 'Caret'>;
  let handler: TableCellsHandler;
  let context: HandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();

    mockBlok = {
      BlockManager: {
        currentBlock: { tool: { isDefault: true }, isEmpty: true },
        insert: vi.fn().mockReturnValue(mockBlock),
      },
      Caret: {
        setToBlock: vi.fn(),
        positions: { END: 'end' },
      },
    } as unknown as Pick<BlokModules, 'BlockManager' | 'Caret'>;

    const toolRegistry = {} as unknown as ToolRegistry;
    const sanitizerBuilder = {} as unknown as SanitizerConfigBuilder;

    handler = new TableCellsHandler(
      mockBlok as unknown as BlokModules,
      toolRegistry,
      sanitizerBuilder,
    );

    context = {
      canReplaceCurrentBlock: true,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // canHandle
  // ---------------------------------------------------------------------------
  describe('canHandle', () => {
    it('should return 90 for HTML containing data-blok-table-cells', () => {
      const html = buildTableHtml([['A', 'B'], ['C', 'D']]);

      expect(handler.canHandle(html)).toBe(90);
    });

    it('should return 0 for regular HTML without the attribute', () => {
      const html = '<table><tr><td>Hello</td></tr></table>';

      expect(handler.canHandle(html)).toBe(0);
    });

    it('should return 0 for non-string data', () => {
      expect(handler.canHandle(123)).toBe(0);
      expect(handler.canHandle(null)).toBe(0);
      expect(handler.canHandle(undefined)).toBe(0);
      expect(handler.canHandle({ key: 'value' })).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // handle
  // ---------------------------------------------------------------------------
  describe('handle', () => {
    it('should return false for non-string data', async () => {
      const result = await handler.handle(42, context);

      expect(result).toBe(false);
    });

    it('should return false when cursor is inside a table cell', async () => {
      // Create a DOM element that simulates a table cell
      const tableCellElement = document.createElement('div');

      tableCellElement.setAttribute('data-blok-table-cell', '');

      const innerElement = document.createElement('span');

      tableCellElement.appendChild(innerElement);
      document.body.appendChild(tableCellElement);

      // Focus the inner element to simulate cursor inside table cell
      innerElement.tabIndex = 0;
      innerElement.focus();

      const html = buildTableHtml([['A']]);
      const result = await handler.handle(html, context);

      expect(result).toBe(false);

      // Clean up
      document.body.removeChild(tableCellElement);
    });

    it('should insert a table block with correct content', async () => {
      const html = buildTableHtml([['Hello', 'World'], ['Foo', 'Bar']]);

      await handler.handle(html, context);

      const insertMock = mockBlok.BlockManager.insert as ReturnType<typeof vi.fn>;

      expect(insertMock).toHaveBeenCalledOnce();

      const callArgs = insertMock.mock.calls[0][0] as {
        tool: string;
        data: { withHeadings: boolean; withHeadingColumn: boolean; content: string[][] };
        replace: boolean;
      };

      expect(callArgs.tool).toBe('table');
      expect(callArgs.data.withHeadings).toBe(false);
      expect(callArgs.data.withHeadingColumn).toBe(false);
      expect(callArgs.data.content).toEqual([
        ['Hello', 'World'],
        ['Foo', 'Bar'],
      ]);
      expect(callArgs.replace).toBe(true);
    });

    it('should return true on successful insert', async () => {
      const html = buildTableHtml([['A']]);
      const result = await handler.handle(html, context);

      expect(result).toBe(true);
    });

    it('should set caret to end of inserted block', async () => {
      const html = buildTableHtml([['A']]);

      await handler.handle(html, context);

      const setToBlockMock = mockBlok.Caret.setToBlock as ReturnType<typeof vi.fn>;

      expect(setToBlockMock).toHaveBeenCalledOnce();
      expect(setToBlockMock).toHaveBeenCalledWith(mockBlock, 'end');
    });

    it('should handle cells with empty blocks as empty strings', async () => {
      const payload: TableCellsClipboard = {
        rows: 1,
        cols: 2,
        cells: [
          [
            { blocks: [] },
            { blocks: [{ tool: 'paragraph', data: { text: 'Hello' } }] },
          ],
        ],
      };
      const html = buildClipboardHtml(payload);

      await handler.handle(html, context);

      const insertMock = mockBlok.BlockManager.insert as ReturnType<typeof vi.fn>;
      const callArgs = insertMock.mock.calls[0][0] as {
        data: { content: string[][] };
      };

      expect(callArgs.data.content).toEqual([['', 'Hello']]);
    });

    it('should not replace block when canReplaceCurrentBlock is false', async () => {
      context.canReplaceCurrentBlock = false;

      const html = buildTableHtml([['A']]);

      await handler.handle(html, context);

      const insertMock = mockBlok.BlockManager.insert as ReturnType<typeof vi.fn>;
      const callArgs = insertMock.mock.calls[0][0] as { replace: boolean };

      expect(callArgs.replace).toBe(false);
    });

    // -------------------------------------------------------------------------
    // Bug #8: TableCellsHandler drops colors when pasting outside table
    // -------------------------------------------------------------------------

    it('should preserve cell color in content when pasting colored cells', async () => {
      const payload: TableCellsClipboard = {
        rows: 1,
        cols: 2,
        cells: [
          [
            { blocks: [{ tool: 'paragraph', data: { text: 'Red BG' } }], color: '#fdebec' },
            { blocks: [{ tool: 'paragraph', data: { text: 'Plain' } }] },
          ],
        ],
      };
      const html = buildClipboardHtml(payload);

      await handler.handle(html, context);

      const insertMock = mockBlok.BlockManager.insert as ReturnType<typeof vi.fn>;
      const callArgs = insertMock.mock.calls[0][0] as {
        data: { content: unknown[][] };
      };

      const cell0 = callArgs.data.content[0][0];

      expect(typeof cell0).toBe('object');
      expect((cell0 as { color?: string }).color).toBe('#fdebec');
    });

    it('should preserve cell textColor in content when pasting colored cells', async () => {
      const payload: TableCellsClipboard = {
        rows: 1,
        cols: 1,
        cells: [
          [
            { blocks: [{ tool: 'paragraph', data: { text: 'Red text' } }], textColor: '#d44c47' },
          ],
        ],
      };
      const html = buildClipboardHtml(payload);

      await handler.handle(html, context);

      const insertMock = mockBlok.BlockManager.insert as ReturnType<typeof vi.fn>;
      const callArgs = insertMock.mock.calls[0][0] as {
        data: { content: unknown[][] };
      };

      const cell0 = callArgs.data.content[0][0];

      expect(typeof cell0).toBe('object');
      expect((cell0 as { textColor?: string }).textColor).toBe('#d44c47');
    });

    it('should preserve both color and textColor in content when pasting cells with both', async () => {
      const payload: TableCellsClipboard = {
        rows: 1,
        cols: 1,
        cells: [
          [
            {
              blocks: [{ tool: 'paragraph', data: { text: 'Both' } }],
              color: '#fbf3db',
              textColor: '#d44c47',
            },
          ],
        ],
      };
      const html = buildClipboardHtml(payload);

      await handler.handle(html, context);

      const insertMock = mockBlok.BlockManager.insert as ReturnType<typeof vi.fn>;
      const callArgs = insertMock.mock.calls[0][0] as {
        data: { content: unknown[][] };
      };

      const cell0 = callArgs.data.content[0][0];

      expect(typeof cell0).toBe('object');
      expect((cell0 as { color?: string; textColor?: string }).color).toBe('#fbf3db');
      expect((cell0 as { color?: string; textColor?: string }).textColor).toBe('#d44c47');
    });

    // -------------------------------------------------------------------------
    // Bug #2: TableCellsHandler discards text for colored cells when pasting
    // outside a table
    // -------------------------------------------------------------------------

    it('should preserve text content in colored cells with background color', async () => {
      const payload: TableCellsClipboard = {
        rows: 1,
        cols: 2,
        cells: [
          [
            { blocks: [{ tool: 'paragraph', data: { text: 'Red BG' } }], color: '#fdebec' },
            { blocks: [{ tool: 'paragraph', data: { text: 'Plain' } }] },
          ],
        ],
      };
      const html = buildClipboardHtml(payload);

      await handler.handle(html, context);

      const insertMock = mockBlok.BlockManager.insert as ReturnType<typeof vi.fn>;
      const callArgs = insertMock.mock.calls[0][0] as {
        data: { content: unknown[][] };
      };

      const cell0 = callArgs.data.content[0][0] as { blocks: string[]; text?: string; color?: string };

      // Text must not be lost just because the cell has a color
      expect(cell0.text).toBe('Red BG');
    });

    it('should preserve text content in cells with text color', async () => {
      const payload: TableCellsClipboard = {
        rows: 1,
        cols: 1,
        cells: [
          [
            { blocks: [{ tool: 'paragraph', data: { text: 'Red text' } }], textColor: '#d44c47' },
          ],
        ],
      };
      const html = buildClipboardHtml(payload);

      await handler.handle(html, context);

      const insertMock = mockBlok.BlockManager.insert as ReturnType<typeof vi.fn>;
      const callArgs = insertMock.mock.calls[0][0] as {
        data: { content: unknown[][] };
      };

      const cell0 = callArgs.data.content[0][0] as { blocks: string[]; text?: string; textColor?: string };

      expect(cell0.text).toBe('Red text');
    });

    it('should preserve text content in cells with both color and textColor', async () => {
      const payload: TableCellsClipboard = {
        rows: 1,
        cols: 1,
        cells: [
          [
            {
              blocks: [{ tool: 'paragraph', data: { text: 'Both colors' } }],
              color: '#fbf3db',
              textColor: '#d44c47',
            },
          ],
        ],
      };
      const html = buildClipboardHtml(payload);

      await handler.handle(html, context);

      const insertMock = mockBlok.BlockManager.insert as ReturnType<typeof vi.fn>;
      const callArgs = insertMock.mock.calls[0][0] as {
        data: { content: unknown[][] };
      };

      const cell0 = callArgs.data.content[0][0] as { blocks: string[]; text?: string; color?: string; textColor?: string };

      expect(cell0.text).toBe('Both colors');
      expect(cell0.color).toBe('#fbf3db');
      expect(cell0.textColor).toBe('#d44c47');
    });

    it('should join text from multiple blocks in colored cells', async () => {
      const payload: TableCellsClipboard = {
        rows: 1,
        cols: 1,
        cells: [
          [
            {
              blocks: [
                { tool: 'paragraph', data: { text: 'Line 1' } },
                { tool: 'paragraph', data: { text: 'Line 2' } },
              ],
              color: '#fdebec',
            },
          ],
        ],
      };
      const html = buildClipboardHtml(payload);

      await handler.handle(html, context);

      const insertMock = mockBlok.BlockManager.insert as ReturnType<typeof vi.fn>;
      const callArgs = insertMock.mock.calls[0][0] as {
        data: { content: unknown[][] };
      };

      const cell0 = callArgs.data.content[0][0] as { blocks: string[]; text?: string };

      expect(cell0.text).toBe('Line 1 Line 2');
    });

    it('should use plain string for cells without color properties', async () => {
      const payload: TableCellsClipboard = {
        rows: 1,
        cols: 1,
        cells: [
          [
            { blocks: [{ tool: 'paragraph', data: { text: 'Plain' } }] },
          ],
        ],
      };
      const html = buildClipboardHtml(payload);

      await handler.handle(html, context);

      const insertMock = mockBlok.BlockManager.insert as ReturnType<typeof vi.fn>;
      const callArgs = insertMock.mock.calls[0][0] as {
        data: { content: unknown[][] };
      };

      expect(callArgs.data.content[0][0]).toBe('Plain');
    });

    // -------------------------------------------------------------------------
    // Bug: focus lost (activeElement === body) but currentBlock is inside a
    // table cell — handler should still bail instead of creating a new table
    // -------------------------------------------------------------------------

    it('returns false when context.currentBlock.holder is inside [data-blok-table-cell-blocks]', async () => {
      // Simulate focus lost — activeElement is body, NOT inside a table cell
      Object.defineProperty(document, 'activeElement', {
        get: () => document.body,
        configurable: true,
      });

      // currentBlock.holder IS inside a table-cell-blocks container
      const cellBlocksContainer = document.createElement('div');

      cellBlocksContainer.setAttribute('data-blok-table-cell-blocks', '');

      const mockHolder = document.createElement('div');

      cellBlocksContainer.appendChild(mockHolder);
      document.body.appendChild(cellBlocksContainer);

      context.currentBlock = { holder: mockHolder } as unknown as import('../../../../../src/components/block').Block;

      const html = buildTableHtml([['A', 'B']]);
      const result = await handler.handle(html, context);

      expect(result).toBe(false);
      expect(mockBlok.BlockManager.insert).not.toHaveBeenCalled();

      // Clean up
      document.body.removeChild(cellBlocksContainer);
    });

    it('returns false when both activeElement is in a cell AND currentBlock holder is in [data-blok-table-cell-blocks]', async () => {
      // activeElement inside [data-blok-table-cell]
      const tableCellElement = document.createElement('div');

      tableCellElement.setAttribute('data-blok-table-cell', '');

      const innerElement = document.createElement('span');

      tableCellElement.appendChild(innerElement);
      document.body.appendChild(tableCellElement);

      Object.defineProperty(document, 'activeElement', {
        get: () => innerElement,
        configurable: true,
      });

      // currentBlock.holder also inside [data-blok-table-cell-blocks]
      const cellBlocksContainer = document.createElement('div');

      cellBlocksContainer.setAttribute('data-blok-table-cell-blocks', '');

      const mockHolder = document.createElement('div');

      cellBlocksContainer.appendChild(mockHolder);
      document.body.appendChild(cellBlocksContainer);

      context.currentBlock = { holder: mockHolder } as unknown as import('../../../../../src/components/block').Block;

      const html = buildTableHtml([['X']]);
      const result = await handler.handle(html, context);

      expect(result).toBe(false);
      expect(mockBlok.BlockManager.insert).not.toHaveBeenCalled();

      // Clean up
      document.body.removeChild(tableCellElement);
      document.body.removeChild(cellBlocksContainer);
    });

    it('returns false when activeElement is body but context.pasteTarget is inside [data-blok-table-cell]', async () => {
      // Simulate the production bug scenario:
      // - document.activeElement is body (focus lost, e.g. React re-render)
      // - currentBlock is NOT in any cell (setCurrentBlockByChildNode failed)
      // - but event.target was the [data-blok-table-cell-blocks] container inside a cell
      Object.defineProperty(document, 'activeElement', {
        get: () => document.body,
        configurable: true,
      });

      const tableCell = document.createElement('div');

      tableCell.setAttribute('data-blok-table-cell', '');

      const cellBlocksContainer = document.createElement('div');

      cellBlocksContainer.setAttribute('data-blok-table-cell-blocks', '');
      tableCell.appendChild(cellBlocksContainer);
      document.body.appendChild(tableCell);

      // currentBlock is NOT in any cell — it's a plain block
      const plainHolder = document.createElement('div');

      document.body.appendChild(plainHolder);
      context.currentBlock = { holder: plainHolder } as unknown as import('../../../../../src/components/block').Block;

      // pasteTarget IS inside [data-blok-table-cell] — this is the fix's new bail condition
      context.pasteTarget = cellBlocksContainer;

      const html = buildTableHtml([['Source Cell']]);
      const result = await handler.handle(html, context);

      expect(result).toBe(false);
      expect(mockBlok.BlockManager.insert).not.toHaveBeenCalled();

      // Clean up
      document.body.removeChild(tableCell);
      document.body.removeChild(plainHolder);
    });

    it('does NOT bail when pasteTarget is outside any table cell', async () => {
      // activeElement is body, currentBlock is not in a cell, AND pasteTarget is outside any cell
      // → handler should proceed and create a new table block
      Object.defineProperty(document, 'activeElement', {
        get: () => document.body,
        configurable: true,
      });

      const plainContainer = document.createElement('div');

      document.body.appendChild(plainContainer);
      context.currentBlock = { holder: plainContainer } as unknown as import('../../../../../src/components/block').Block;

      // pasteTarget is outside any [data-blok-table-cell]
      const outsideTarget = document.createElement('span');

      document.body.appendChild(outsideTarget);
      context.pasteTarget = outsideTarget;

      const html = buildTableHtml([['A', 'B']]);
      const result = await handler.handle(html, context);

      expect(result).toBe(true);
      expect(mockBlok.BlockManager.insert).toHaveBeenCalledOnce();

      const insertMock = mockBlok.BlockManager.insert as ReturnType<typeof vi.fn>;
      const callArgs = insertMock.mock.calls[0][0] as { tool: string };

      expect(callArgs.tool).toBe('table');

      // Clean up
      document.body.removeChild(plainContainer);
      document.body.removeChild(outsideTarget);
    });

    it('creates new table block when activeElement is body AND currentBlock is NOT in a cell', async () => {
      // Focus lost — activeElement is body
      Object.defineProperty(document, 'activeElement', {
        get: () => document.body,
        configurable: true,
      });

      // currentBlock.holder is a plain div NOT inside any table cell container
      const plainHolder = document.createElement('div');

      document.body.appendChild(plainHolder);

      context.currentBlock = { holder: plainHolder } as unknown as import('../../../../../src/components/block').Block;

      const html = buildTableHtml([['Hello', 'World']]);
      const result = await handler.handle(html, context);

      expect(result).toBe(true);
      expect(mockBlok.BlockManager.insert).toHaveBeenCalledOnce();

      const insertMock = mockBlok.BlockManager.insert as ReturnType<typeof vi.fn>;
      const callArgs = insertMock.mock.calls[0][0] as { tool: string };

      expect(callArgs.tool).toBe('table');

      // Clean up
      document.body.removeChild(plainHolder);
    });
  });
});
