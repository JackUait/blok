import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutputBlockData, OutputData } from '../../../../../types';
import { boot, settle, viewTable, type Booted } from './roundtrip-harness';
import { blockTextAsHtml } from '../../../helpers/saved-as-html';

/**
 * `blocks.update(tableId, data)` on an editable table goes through
 * Table.setData. Outside a Yjs sync, setData deletes every block mounted in
 * the grid BEFORE it re-mounts the cells listed in the new data — so when the
 * new data still references the same child blocks (a styling change, a
 * heading toggle, a partial update that core merges with the old data), every
 * referenced block is already gone and each cell is refilled with an empty
 * paragraph.
 */
const doc = (): OutputData => ({
  blocks: [
    {
      id: 't',
      type: 'table',
      data: {
        withHeadings: false,
        withHeadingColumn: false,
        content: [
          [{ blocks: ['a'] }, { blocks: ['b'] }],
          [{ blocks: ['c'] }, { blocks: ['d'] }],
        ],
      },
      content: ['a', 'b', 'c', 'd'],
    },
    { id: 'a', type: 'paragraph', parent: 't', data: { text: 'A' } },
    { id: 'b', type: 'paragraph', parent: 't', data: { text: 'B' } },
    { id: 'c', type: 'paragraph', parent: 't', data: { text: 'C' } },
    { id: 'd', type: 'paragraph', parent: 't', data: { text: 'D' } },
  ] as OutputBlockData[],
});

const EXPECTED_TEXTS = [
  [['paragraph:A'], ['paragraph:B']],
  [['paragraph:C'], ['paragraph:D']],
];

const gridTexts = (out: OutputData | undefined): string[][][] | undefined =>
  viewTable(out)?.grid.map(row => row.map(cell => cell.texts));

describe('blocks.update on an editable table keeps the cell blocks it still references', () => {
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

  it('full update that only adds a cell color keeps every cell text', async () => {
    booted = await boot(doc());
    await booted.editor.blocks.update('t', {
      withHeadings: false,
      withHeadingColumn: false,
      content: [
        [{ blocks: ['a'], color: '#fbecdd' }, { blocks: ['b'] }],
        [{ blocks: ['c'] }, { blocks: ['d'] }],
      ],
    });
    await settle();

    const out = await booted.editor.save();

    expect(gridTexts(out)).toEqual(EXPECTED_TEXTS);
    expect(viewTable(out)?.grid[0][0].color).toBe('#fbecdd');
  });

  it('partial update { withHeadings: true } keeps every cell text', async () => {
    booted = await boot(doc());
    await booted.editor.blocks.update('t', { withHeadings: true });
    await settle();

    const out = await booted.editor.save();

    expect(gridTexts(out)).toEqual(EXPECTED_TEXTS);
  });

  it('production build: partial update { withHeadings: true } keeps every cell text', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    booted = await boot(doc());
    await booted.editor.blocks.update('t', { withHeadings: true });
    await settle();

    const out = await booted.editor.save();

    expect(gridTexts(out)).toEqual(EXPECTED_TEXTS);
    expect(out?.blocks.map(b => blockTextAsHtml(b)).filter(Boolean)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('the referenced child blocks still exist after the update', async () => {
    booted = await boot(doc());
    await booted.editor.blocks.update('t', { withHeadings: true });
    await settle();

    expect(['a', 'b', 'c', 'd'].map(id => booted?.editor.blocks.getById(id) !== null)).toEqual([true, true, true, true]);
  });

  it('keeps the original cell block ids instead of duplicates', async () => {
    booted = await boot(doc());
    await booted.editor.blocks.update('t', { withHeadings: true });
    await settle();

    const out = await booted.editor.save();
    const content = (out?.blocks.find(b => b.id === 't')?.data as { content: Array<Array<{ blocks: string[] }>> }).content;

    expect(content.map(row => row.map(cell => cell.blocks))).toEqual([[['a'], ['b']], [['c'], ['d']]]);
    expect(out?.blocks.map(b => b.id).sort()).toEqual(['a', 'b', 'c', 'd', 't']);
  });

  it('keeps the children of a kept toggle in a cell', async () => {
    booted = await boot({
      blocks: [
        {
          id: 't',
          type: 'table',
          data: { withHeadings: false, content: [[{ blocks: ['tg'] }, { blocks: ['b'] }]] },
          content: ['tg', 'b'],
        },
        { id: 'tg', type: 'toggle', parent: 't', data: { text: 'Toggle', isOpen: true }, content: ['k'] },
        { id: 'k', type: 'paragraph', parent: 'tg', data: { text: 'Kid' } },
        { id: 'b', type: 'paragraph', parent: 't', data: { text: 'B' } },
      ] as OutputBlockData[],
    });
    await booted.editor.blocks.update('t', { withHeadings: true });
    await settle();

    const out = await booted.editor.save();
    const kid = out?.blocks.find(b => b.id === 'k');

    expect(kid?.parent).toBe('tg');
    expect(blockTextAsHtml(kid)).toBe('Kid');
  });

  it('keeps the cell blocks of a nested table in a cell', async () => {
    booted = await boot({
      blocks: [
        {
          id: 't',
          type: 'table',
          data: { withHeadings: false, content: [[{ blocks: ['nt'] }, { blocks: ['b'] }]] },
          content: ['nt', 'b'],
        },
        { id: 'nt', type: 'table', parent: 't', data: { withHeadings: false, content: [[{ blocks: ['p'] }]] }, content: ['p'] },
        { id: 'p', type: 'paragraph', parent: 'nt', data: { text: 'Nested' } },
        { id: 'b', type: 'paragraph', parent: 't', data: { text: 'B' } },
      ] as OutputBlockData[],
    });

    expect(booted.holder.querySelectorAll('[data-blok-table-cell] [data-blok-table-cell]')).toHaveLength(1);

    await booted.editor.blocks.update('t', { withHeadings: true });
    await settle();

    const out = await booted.editor.save();
    const p = out?.blocks.find(b => b.id === 'p');

    expect(p?.parent).toBe('nt');
    expect(blockTextAsHtml(p)).toBe('Nested');
  });

  it('deletes a cell block the new content no longer names', async () => {
    booted = await boot(doc());
    await booted.editor.blocks.update('t', {
      content: [
        [{ blocks: ['a'] }, { blocks: ['b'] }],
        [{ blocks: ['c'] }, { blocks: ['a2'] }],
      ],
    });
    await settle();

    const out = await booted.editor.save();

    expect(booted.editor.blocks.getById('d')).toBeNull();
    expect(out?.blocks.some(b => b.id === 'd')).toBe(false);
  });
});

describe('blocks.update on a read-only table', () => {
  let booted: Booted | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    booted?.editor.destroy();
    booted?.holder.remove();
    booted = null;
    vi.restoreAllMocks();
  });

  it('shows the real cell block holders, not copies', async () => {
    booted = await boot(doc(), { readOnly: true });
    await booted.editor.blocks.update('t', { withHeadings: true });
    await settle();

    expect(['a', 'b', 'c', 'd'].map(id => booted?.editor.blocks.getById(id)?.holder.isConnected)).toEqual([true, true, true, true]);
    expect(Array.from(booted.holder.querySelectorAll('[data-blok-table-cell]'), c => (c.textContent ?? '').trim())).toEqual(['A', 'B', 'C', 'D']);
  });
});
