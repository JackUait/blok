import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutputBlockData, OutputData } from '../../../../../types';
import { boot, settle, viewTable, type Booted, type TableView } from './roundtrip-harness';

/**
 * A 3x3 table using every persisted feature: a horizontal merge, colors,
 * placement, widths, text size, stretched, both heading flags, a cell with
 * several blocks including a list item.
 */
const richDocument = (): OutputData => ({
  blocks: [
    {
      id: 't',
      type: 'table',
      data: {
        withHeadings: true,
        withHeadingColumn: true,
        stretched: true,
        textSize: 'comfortable',
        colWidths: [120, 200, 160],
        initialColWidth: 160,
        content: [
          [
            { blocks: ['a'], colspan: 2, color: '#fbecdd', textColor: '#d9730d', placement: 'middle-center' },
            { blocks: [], mergedInto: [0, 0] },
            { blocks: ['b'], color: '#e7f3f8' },
          ],
          [
            { blocks: ['c1', 'c2', 'c3'], placement: 'bottom-right' },
            { blocks: ['d'], textColor: '#448361' },
            { blocks: ['e'] },
          ],
          [
            { blocks: ['f'] },
            { blocks: ['g'] },
            { blocks: ['h'], color: 'rgb(1, 2, 3)' },
          ],
        ],
      },
      content: ['a', 'b', 'c1', 'c2', 'c3', 'd', 'e', 'f', 'g', 'h'],
    },
    { id: 'a', type: 'paragraph', parent: 't', data: { text: 'Merged <strong>head</strong>' } },
    { id: 'b', type: 'paragraph', parent: 't', data: { text: 'B' } },
    { id: 'c1', type: 'paragraph', parent: 't', data: { text: 'C one' } },
    { id: 'c2', type: 'list', parent: 't', data: { text: 'C item', style: 'unordered' } },
    { id: 'c3', type: 'paragraph', parent: 't', data: { text: 'C three' } },
    { id: 'd', type: 'paragraph', parent: 't', data: { text: 'D' } },
    { id: 'e', type: 'paragraph', parent: 't', data: { text: 'E' } },
    { id: 'f', type: 'paragraph', parent: 't', data: { text: 'F' } },
    { id: 'g', type: 'paragraph', parent: 't', data: { text: 'G' } },
    { id: 'h', type: 'paragraph', parent: 't', data: { text: 'H' } },
    { id: 'after', type: 'paragraph', data: { text: 'After table' } },
  ] as OutputBlockData[],
});

describe('table round trip in one editor keeps every persisted field', () => {
  let booted: Booted | null = null;
  let expected: TableView | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    expected = viewTable(richDocument(), 0, { allowHtml: true });
  });

  afterEach(() => {
    booted?.editor.destroy();
    booted?.holder.remove();
    booted = null;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const saveChecked = async (): Promise<OutputData | undefined> => {
    const out = await booted?.editor.save();

    expect(booted?.onError).not.toHaveBeenCalled();

    return out;
  };

  it('edit boot → save', async () => {
    booted = await boot(richDocument());
    expect(viewTable(await saveChecked())).toEqual(expected);
  });

  it('read-only boot → edit → save', async () => {
    booted = await boot(richDocument(), { readOnly: true });
    await booted.editor.readOnly.set(false);
    await settle();
    expect(viewTable(await saveChecked())).toEqual(expected);
  });

  it('edit → read-only → edit, three cycles, saving each step', async () => {
    booted = await boot(richDocument());

    for (let i = 0; i < 3; i++) {
      await booted.editor.readOnly.set(true);
      await settle();
      await booted.editor.readOnly.set(false);
      await settle();
      expect(viewTable(await saveChecked())).toEqual(expected);
    }
  });

  it('save → blocks.render(saved) → save is stable', async () => {
    booted = await boot(richDocument());
    const first = await saveChecked();

    await booted.editor.blocks.render(first as OutputData);
    await settle();
    const second = await saveChecked();

    expect(viewTable(second)).toEqual(expected);
    expect(second?.blocks).toEqual(first?.blocks);
  });

  it('read-only: blocks.render(saved) → edit → save', async () => {
    booted = await boot(richDocument());
    const first = await saveChecked();

    await booted.editor.readOnly.set(true);
    await settle();
    await booted.editor.blocks.render(first as OutputData);
    await settle();
    await booted.editor.readOnly.set(false);
    await settle();
    expect(viewTable(await saveChecked())).toEqual(expected);
  });

  it('detached-holder boot → save', async () => {
    booted = await boot(richDocument(), { detached: true });
    expect(viewTable(await saveChecked())).toEqual(expected);
  });

  it('detached-holder read-only boot → edit → save', async () => {
    booted = await boot(richDocument(), { detached: true, readOnly: true });
    await booted.editor.readOnly.set(false);
    await settle();
    expect(viewTable(await saveChecked())).toEqual(expected);
  });

  for (const dataModel of ['legacy', 'flat', 'hierarchical', 'auto'] as const) {
    it(`dataModel ${dataModel}: edit boot → save`, async () => {
      booted = await boot(richDocument(), { dataModel });
      // Legacy output stays HTML until task A3.
      expect(viewTable(await saveChecked(), 0, { allowHtml: dataModel === 'legacy' })).toEqual(expected);
    });
  }
});
