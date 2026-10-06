import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutputBlockData, OutputData } from '../../../../../types';
import { boot, settle, viewTable, type Booted } from './roundtrip-harness';

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

describe('table writes made while read-only survive the switch to edit', () => {
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

  it('blocks.update(table, styling) while read-only, then edit → save', async () => {
    booted = await boot(doc(), { readOnly: true });
    await booted.editor.blocks.update('t', {
      withHeadings: true,
      content: [
        [{ blocks: ['a'], color: '#fbecdd' }, { blocks: ['b'], placement: 'middle-center' }],
        [{ blocks: ['c'] }, { blocks: ['d'], textColor: '#448361' }],
      ],
    });
    await settle();
    await booted.editor.readOnly.set(false);
    await settle();

    const out = await booted.editor.save();

    expect(booted.onError).not.toHaveBeenCalled();
    expect(viewTable(out)?.withHeadings).toBe(true);
    expect(viewTable(out)?.grid).toEqual([
      [{ texts: ['paragraph:A'], color: '#fbecdd' }, { texts: ['paragraph:B'], placement: 'middle-center' }],
      [{ texts: ['paragraph:C'] }, { texts: ['paragraph:D'], textColor: '#448361' }],
    ]);
  });

  it('partial blocks.update(table, { withHeadings }) keeps the grid', async () => {
    booted = await boot(doc());
    await booted.editor.blocks.update('t', { withHeadings: true });
    await settle();

    const out = await booted.editor.save();

    expect(booted.onError).not.toHaveBeenCalled();
    expect(viewTable(out)?.withHeadings).toBe(true);
    expect(viewTable(out)?.grid).toEqual([
      [{ texts: ['paragraph:A'] }, { texts: ['paragraph:B'] }],
      [{ texts: ['paragraph:C'] }, { texts: ['paragraph:D'] }],
    ]);
  });

  it('partial blocks.update(table, { withHeadings }) while read-only, then edit → save', async () => {
    booted = await boot(doc(), { readOnly: true });
    await booted.editor.blocks.update('t', { withHeadings: true });
    await settle();
    await booted.editor.readOnly.set(false);
    await settle();

    const out = await booted.editor.save();

    expect(booted.onError).not.toHaveBeenCalled();
    expect(viewTable(out)?.withHeadings).toBe(true);
    expect(viewTable(out)?.grid).toEqual([
      [{ texts: ['paragraph:A'] }, { texts: ['paragraph:B'] }],
      [{ texts: ['paragraph:C'] }, { texts: ['paragraph:D'] }],
    ]);
  });

  it('blocks.update(table, styling) while read-only, then edit → save → render → save', async () => {
    booted = await boot(doc(), { readOnly: true });
    await booted.editor.blocks.update('t', {
      content: [
        [{ blocks: ['a'], color: '#fbecdd' }, { blocks: ['b'] }],
        [{ blocks: ['c'] }, { blocks: ['d'] }],
      ],
    });
    await settle();
    await booted.editor.readOnly.set(true);
    await settle();
    await booted.editor.readOnly.set(false);
    await settle();

    const first = await booted.editor.save();

    await booted.editor.blocks.render(first as OutputData);
    await settle();
    const out = await booted.editor.save();

    expect(booted.onError).not.toHaveBeenCalled();
    expect(viewTable(out)?.grid).toEqual([
      [{ texts: ['paragraph:A'], color: '#fbecdd' }, { texts: ['paragraph:B'] }],
      [{ texts: ['paragraph:C'] }, { texts: ['paragraph:D'] }],
    ]);
  });

  it('a child paragraph edited by blocks.update while read-only keeps its text after edit', async () => {
    booted = await boot(doc(), { readOnly: true });
    await booted.editor.blocks.update('b', { text: 'B changed' });
    await settle();
    await booted.editor.readOnly.set(false);
    await settle();

    const out = await booted.editor.save();

    expect(booted.onError).not.toHaveBeenCalled();
    expect(viewTable(out)?.grid).toEqual([
      [{ texts: ['paragraph:A'] }, { texts: ['paragraph:B changed'] }],
      [{ texts: ['paragraph:C'] }, { texts: ['paragraph:D'] }],
    ]);
  });

  it('blocks inserted into the table while read-only (parent=table) are referenced after edit', async () => {
    booted = await boot(doc(), { readOnly: true });
    const added = await booted.editor.blocks.insert('paragraph', { text: 'New' }, {}, 1, false);

    await booted.editor.blocks.update('t', {
      content: [
        [{ blocks: ['a', added.id] }, { blocks: ['b'] }],
        [{ blocks: ['c'] }, { blocks: ['d'] }],
      ],
    });
    booted.editor.blocks.setBlockParent(added.id, 't');
    await settle();
    await booted.editor.readOnly.set(false);
    await settle();

    const out = await booted.editor.save();

    expect(booted.onError).not.toHaveBeenCalled();
    expect(viewTable(out)?.grid).toEqual([
      [{ texts: ['paragraph:A', 'paragraph:New'] }, { texts: ['paragraph:B'] }],
      [{ texts: ['paragraph:C'] }, { texts: ['paragraph:D'] }],
    ]);
  });
});
