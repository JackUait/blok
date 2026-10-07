import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutputBlockData, OutputData } from '../../../../../types';
import { allTexts, boot, settle, viewTable, type Booted } from './roundtrip-harness';
import type { HtmlReadOptions } from '../../../helpers/saved-as-html';

const stringTable = (): OutputData => ({
  blocks: [
    {
      id: 't',
      type: 'table',
      data: {
        withHeadings: true,
        withHeadingColumn: false,
        stretched: true,
        colWidths: [100, 200],
        content: [
          ['Head <strong>1</strong>', 'Head 2'],
          ['Line one<br>line two', '<ul><li>x</li><li>y</li></ul>'],
          ['', 'Last'],
        ],
      },
    },
    { id: 'p', type: 'paragraph', data: { text: 'After' } },
  ] as OutputBlockData[],
});

const mixedTable = (): OutputData => ({
  blocks: [
    {
      id: 't',
      type: 'table',
      data: {
        withHeadings: false,
        content: [
          [{ blocks: ['a'], color: '#fbecdd' }, 'legacy B'],
          ['legacy C', { blocks: ['d'] }],
        ],
      },
    },
    { id: 'a', type: 'paragraph', parent: 't', data: { text: 'A' } },
    { id: 'd', type: 'paragraph', parent: 't', data: { text: 'D' } },
  ] as OutputBlockData[],
});

const cellTexts = (out: OutputData | undefined, options: HtmlReadOptions = {}): string[][] | undefined =>
  viewTable(out, 0, options)?.grid.map(row => row.map(cell => cell.texts.join(' | ')));

describe('legacy and mixed table data survive a save → render → save round trip', () => {
  let booted: Booted | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    booted?.editor.destroy();
    booted?.holder.remove();
    booted = null;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  for (const dataModel of ['legacy', 'flat', 'hierarchical', 'auto'] as const) {
    for (const readOnly of [false, true]) {
      it(`string cells, dataModel ${dataModel}, ${readOnly ? 'read-only boot → edit' : 'edit boot'} → save → render → save`, async () => {
        booted = await boot(stringTable(), { dataModel, readOnly });

        if (readOnly) {
          await booted.editor.readOnly.set(false);
          await settle();
        }

        const first = await booted.editor.save();
        // Legacy output (legacy, or auto with this legacy input) stays HTML until task A3.
        const html = { allowHtml: dataModel === 'legacy' || dataModel === 'auto' };

        expect(booted.onError).not.toHaveBeenCalled();
        const firstView = viewTable(first, 0, html);

        expect(firstView?.withHeadings).toBe(true);
        expect(firstView?.stretched).toBe(true);
        expect(firstView?.colWidths).toEqual([100, 200]);
        expect(cellTexts(first, html)).toEqual([
          ['paragraph:Head <strong>1</strong>', 'paragraph:Head 2'],
          ['paragraph:Line one | paragraph:line two', 'list:x | list:y'],
          ['paragraph:', 'paragraph:Last'],
        ]);
        expect(firstView?.rootTexts).toEqual(['paragraph:After']);

        await booted.editor.blocks.render(first as OutputData);
        await settle();
        const second = await booted.editor.save();

        expect(booted.onError).not.toHaveBeenCalled();
        expect(cellTexts(second, html)).toEqual(cellTexts(first, html));
        expect(allTexts(second, html)).toEqual(allTexts(first, html));
      });
    }
  }

  for (const readOnly of [false, true]) {
    it(`mixed string/block-ref grid, ${readOnly ? 'read-only boot → edit' : 'edit boot'} → save`, async () => {
      booted = await boot(mixedTable(), { readOnly });

      if (readOnly) {
        await booted.editor.readOnly.set(false);
        await settle();
      }

      const out = await booted.editor.save();

      expect(booted.onError).not.toHaveBeenCalled();
      // auto with legacy input: legacy output, still HTML until task A3.
      expect(cellTexts(out, { allowHtml: true })).toEqual([
        ['paragraph:A', 'paragraph:legacy B'],
        ['paragraph:legacy C', 'paragraph:D'],
      ]);
      expect(viewTable(out, 0, { allowHtml: true })?.grid[0][0].color).toBe('#fbecdd');
    });
  }

  it('string cells: read-only boot → edit → read-only → edit → save', async () => {
    booted = await boot(stringTable(), { readOnly: true });
    await booted.editor.readOnly.set(false);
    await settle();
    await booted.editor.readOnly.set(true);
    await settle();
    await booted.editor.readOnly.set(false);
    await settle();

    const out = await booted.editor.save();

    expect(booted.onError).not.toHaveBeenCalled();
    // auto with legacy input: legacy output, still HTML until task A3.
    expect(cellTexts(out, { allowHtml: true })).toEqual([
      ['paragraph:Head <strong>1</strong>', 'paragraph:Head 2'],
      ['paragraph:Line one | paragraph:line two', 'list:x | list:y'],
      ['paragraph:', 'paragraph:Last'],
    ]);
  });
});
