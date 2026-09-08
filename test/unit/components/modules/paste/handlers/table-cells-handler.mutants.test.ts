import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { Block } from '../../../../../../src/components/block';
import type { SanitizerConfigBuilder } from '../../../../../../src/components/modules/paste/sanitizer-config';
import type { ToolRegistry } from '../../../../../../src/components/modules/paste/tool-registry';
import type { HandlerContext } from '../../../../../../src/components/modules/paste/types';
import { TableCellsHandler } from '../../../../../../src/components/modules/paste/handlers/table-cells-handler';
import type {
  ClipboardBlockData,
  LegacyCellContent,
  TableCellsClipboard,
  TableClipboardCell,
} from '../../../../../../src/tools/table/types';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';

/**
 * Mutant-killing coverage for `TableCellsHandler`.
 *
 * Proven-equivalent mutants (no input can distinguish them), all on the
 * `if (colspan > 1 || rowspan > 1)` guard inside `collectCoveredSlots` -
 * the condition forced to true, and each comparison relaxed to `>=`:
 *
 * The guard only decides whether `markFootprint` is called; `markFootprint`
 * itself writes nothing unless the footprint has a slot other than its origin.
 * Its two loops are `Array.from({ length: span })`, whose element count is
 * ToLength(span) - truncated toward zero and clamped at 0. So whenever the
 * guard newly fires both spans are at most 1, the loops produce at most the
 * single (0, 0) pair, and that pair is the one the body skips. Fuzzed over 200000 random payloads - spans drawn from
 * undefined, null, 0, 1, 2, 3, -1, -5, 0.5, 1.5, 1.9, "2", "abc", 1e9, true and
 * false, with grids whose physical cell counts disagree with the declared rows
 * and cols - all three mutants produced a byte-identical covered map.
 */
describe('TableCellsHandler mutants', () => {
  interface InsertOptions {
    tool: string;
    data: {
      withHeadings: boolean;
      withHeadingColumn: boolean;
      content: LegacyCellContent[][];
    };
    replace: boolean;
    origin: string;
  }

  let insert: ReturnType<typeof createInsertMock>;
  let setToBlock: ReturnType<typeof vi.fn>;
  let handler: TableCellsHandler;
  let context: HandlerContext;

  const insertedBlock = {} as unknown as Block;

  const createInsertMock = (): ReturnType<typeof vi.fn<(options: InsertOptions) => Block>> =>
    vi.fn((_options: InsertOptions): Block => insertedBlock);

  const paragraph = (text: string): ClipboardBlockData => ({
    tool: 'paragraph',
    data: { text },
  });

  const cellOf = (
    blocks: ClipboardBlockData[],
    extra: Partial<TableClipboardCell> = {}
  ): TableClipboardCell => ({
    blocks,
    ...extra,
  });

  /**
   * The parser reads the payload out of a single-quoted attribute, so the
   * serialized JSON must never contain an apostrophe.
   */
  const clipboardHtml = (payload: TableCellsClipboard): string =>
    `<table data-blok-table-cells='${JSON.stringify(payload)}'></table>`;

  const singleCellPayload = (
    blocks: ClipboardBlockData[],
    extra: Partial<TableClipboardCell> = {}
  ): TableCellsClipboard => ({
    rows: 1,
    cols: 1,
    cells: [[cellOf(blocks, extra)]],
  });

  const insertedContent = (): LegacyCellContent[][] => {
    const call = insert.mock.calls[0];

    if (call === undefined) {
      throw new Error('BlockManager.insert was never called');
    }

    return call[0].data.content;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    insert = createInsertMock();
    setToBlock = vi.fn();

    const Blok = {
      BlockManager: { insert },
      Caret: { setToBlock, positions: { START: 'start', END: 'end' } },
    } as unknown as BlokModules;

    handler = new TableCellsHandler(
      Blok,
      {} as unknown as ToolRegistry,
      {} as unknown as SanitizerConfigBuilder
    );

    context = { canReplaceCurrentBlock: true };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('input type guards', () => {
    it('scores only a real string, not a value that merely stringifies to one', () => {
      const html = clipboardHtml(singleCellPayload([paragraph('a')]));

      expect(handler.canHandle(html)).toBe(90);
      expect(handler.canHandle({ toString: () => html })).toBe(0);
    });

    it('refuses to handle a value that merely stringifies to clipboard html', async () => {
      const html = clipboardHtml(singleCellPayload([paragraph('a')]));

      await expect(handler.handle({ toString: () => html }, context)).resolves.toBe(false);
      expect(insert).not.toHaveBeenCalled();
    });

    it('refuses html that carries no clipboard payload', async () => {
      await expect(handler.handle('<p>just text</p>', context)).resolves.toBe(false);
      expect(insert).not.toHaveBeenCalled();
    });
  });

  describe('bail-out probes', () => {
    it('handles a paste while the document reports no active element', async () => {
      const html = clipboardHtml(singleCellPayload([paragraph('a')]));

      Object.defineProperty(document, 'activeElement', {
        configurable: true,
        get: () => null,
      });

      let outcome: unknown;

      try {
        outcome = await handler.handle(html, context);
      } catch (error) {
        outcome = error;
      } finally {
        Reflect.deleteProperty(document, 'activeElement');
      }

      expect(outcome).toBe(true);
    });

    it('handles a paste when the current block has no holder', async () => {
      const html = clipboardHtml(singleCellPayload([paragraph('a')]));
      const holderless: HandlerContext = {
        canReplaceCurrentBlock: false,
        currentBlock: {} as unknown as Block,
      };

      await expect(handler.handle(html, holderless)).resolves.toBe(true);
    });
  });

  describe('inserted table block', () => {
    it('records the paste origin and the replace decision', async () => {
      const html = clipboardHtml(singleCellPayload([paragraph('a')]));

      await handler.handle(html, context);

      const call = insert.mock.calls[0];

      expect(call?.[0].origin).toBe('paste');
      expect(call?.[0].replace).toBe(true);
      expect(setToBlock).toHaveBeenCalledWith(insertedBlock, 'end');
    });
  });

  describe('cell content', () => {
    it('keeps a merge origin and points its covered slot back at it', async () => {
      const html = clipboardHtml({
        rows: 1,
        cols: 2,
        cells: [[cellOf([paragraph('a')], { colspan: 2 }), cellOf([], { covered: true })]],
      });

      await handler.handle(html, context);

      const content = insertedContent();

      expect(content[0][0]).toStrictEqual({ blocks: [], text: 'a', colspan: 2 });
      expect(content[0][1]).toStrictEqual({ blocks: [], mergedInto: [0, 0] });
    });

    it('omits an unmerged span from a coloured cell', async () => {
      const html = clipboardHtml(singleCellPayload([paragraph('hi')], { color: 'red' }));

      await handler.handle(html, context);

      expect(insertedContent()[0][0]).toStrictEqual({ blocks: [], text: 'hi', color: 'red' });
    });

    it('clamps a column span that reaches past the payload width', async () => {
      const html = clipboardHtml({
        rows: 1,
        cols: 2,
        cells: [[cellOf([paragraph('a')]), cellOf([paragraph('b')], { colspan: 2 })]],
      });

      await handler.handle(html, context);

      const content = insertedContent();

      expect(content[0][0]).toBe('a');
      expect(content[0][1]).toBe('b');
    });

    it('clamps a row span that reaches past the payload height', async () => {
      const html = clipboardHtml({
        rows: 2,
        cols: 1,
        cells: [[cellOf([paragraph('a')])], [cellOf([paragraph('b')], { rowspan: 2 })]],
      });

      await handler.handle(html, context);

      const content = insertedContent();

      expect(content[0][0]).toBe('a');
      expect(content[1][0]).toBe('b');
    });
  });

  describe('structured block seeding', () => {
    it('seeds a tuned paragraph structurally instead of through the text channel', async () => {
      const tuned: ClipboardBlockData = {
        tool: 'paragraph',
        data: { text: 'hi' },
        tunes: { alignment: { align: 'center' } },
      };
      const html = clipboardHtml(singleCellPayload([tuned]));

      await handler.handle(html, context);

      expect(insertedContent()[0][0]).toStrictEqual({
        blocks: [],
        text: 'hi',
        blockData: [tuned],
      });
    });

    it('seeds a non-paragraph, non-list block structurally', async () => {
      const header: ClipboardBlockData = { tool: 'header', data: { text: 'H' } };
      const html = clipboardHtml(singleCellPayload([header]));

      await handler.handle(html, context);

      expect(insertedContent()[0][0]).toStrictEqual({
        blocks: [],
        text: 'H',
        blockData: [header],
      });
    });

    it('seeds a paragraph without string text structurally', async () => {
      const textless: ClipboardBlockData = { tool: 'paragraph', data: { level: 2 } };
      const html = clipboardHtml(singleCellPayload([textless]));

      await handler.handle(html, context);

      expect(insertedContent()[0][0]).toStrictEqual({
        blocks: [],
        text: '',
        blockData: [textless],
      });
    });
  });
});
