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
  });
});
