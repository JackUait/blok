import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Table } from '../../../../src/tools/table';
import { blocksToHtml } from '../../../../src/view';
import type { API, OutputBlockData, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  readOnly: { set: (state: boolean) => Promise<unknown> };
}

describe('table renders its saved JSON like the view does', () => {
  let holder: HTMLDivElement;
  let editor: TestEditor | null = null;

  const nextFrame = (): Promise<void> => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

  const boot = async (blocks: OutputBlockData[], readOnly = false): Promise<void> => {
    editor = new Blok({
      holder,
      readOnly,
      tools: { table: Table, paragraph: Paragraph },
      data: { blocks },
    }) as unknown as TestEditor;
    await editor.isReady;
    await nextFrame();
  };

  const cellTexts = (): string[][] => {
    const table = holder.querySelector('table');

    return Array.from(table?.tBodies[0]?.rows ?? [], row =>
      Array.from(row.cells, cell => cell.textContent?.trim() ?? ''));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = null;
    holder.remove();
    vi.restoreAllMocks();
  });

  const duplicateIdTable: OutputBlockData[] = [
    {
      id: 't',
      type: 'table',
      data: { withHeadings: false, content: [[{ blocks: ['c'] }, { blocks: ['c'], text: 'STALE' }]] },
      content: ['c'],
    },
    { id: 'c', type: 'paragraph', parent: 't', data: { text: 'Child' } },
  ];

  it('does not show the stale text of a cell whose only block id an earlier cell owns', async () => {
    await boot(duplicateIdTable);

    expect(cellTexts()).toEqual([['Child', '']]);
    expect(blocksToHtml({ blocks: duplicateIdTable })).not.toContain('STALE');
  });

  it('does not show that stale text in read-only mode either', async () => {
    await boot(duplicateIdTable, true);

    expect(cellTexts()).toEqual([['Child', '']]);
  });

  it('shows and keeps a cell\'s text when none of its block ids resolve', async () => {
    await boot([
      { id: 't', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['missing'], text: 'Saved fallback' }]] } },
    ]);
    // Unresolved cells are filled once the render's sync window closes.
    await Array.from({ length: 8 }).reduce<Promise<void>>(previous => previous.then(nextFrame), Promise.resolve());

    expect(cellTexts()).toEqual([['Saved fallback']]);

    const saved = await editor?.save();
    const table = saved?.blocks.find(block => block.id === 't');
    const content: unknown = table?.data.content;
    const cell: unknown = Array.isArray(content) && Array.isArray(content[0]) ? content[0][0] : undefined;
    const ids = typeof cell === 'object' && cell !== null && 'blocks' in cell && Array.isArray(cell.blocks) ? cell.blocks : [];
    const texts = saved?.blocks.filter(block => ids.includes(block.id)).map(block => block.data.text);

    expect(texts).toEqual(['Saved fallback']);
  });

  const missingIdTable: OutputBlockData[] = [
    { id: 't', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['missing'], text: 'Saved fallback' }]] } },
  ];

  const settle = (): Promise<void> =>
    Array.from({ length: 8 }).reduce<Promise<void>>(previous => previous.then(nextFrame), Promise.resolve());

  const setReadOnly = async (state: boolean): Promise<void> => {
    await editor?.readOnly.set(state);
    await settle();
  };

  it('shows a cell\'s text in read-only mode when none of its block ids resolve', async () => {
    await boot(missingIdTable, true);

    expect(cellTexts()).toEqual([['Saved fallback']]);
    expect(blocksToHtml({ blocks: missingIdTable })).toContain('Saved fallback');
  });

  it('sanitizes that text before painting it in read-only mode', async () => {
    await boot([
      { id: 't', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['missing'], text: '<b>ok</b><img src="x" onerror="alert(1)">' }]] } },
    ], true);

    const cell = holder.querySelector('table td');

    expect(cell?.textContent?.trim()).toBe('ok');
    expect(cell?.querySelector('img')).toBeNull();
  });

  it('keeps that text across read-only to edit and back', async () => {
    await boot(missingIdTable, true);
    await setReadOnly(false);

    expect(cellTexts()).toEqual([['Saved fallback']]);

    await setReadOnly(true);

    expect(cellTexts()).toEqual([['Saved fallback']]);
  });

  it('keeps that text when an edited table turns read-only', async () => {
    await boot(missingIdTable);
    await settle();
    await setReadOnly(true);

    expect(cellTexts()).toEqual([['Saved fallback']]);
  });

  it('keeps the stale duplicate-id text hidden when an edited table turns read-only', async () => {
    await boot(duplicateIdTable);
    await setReadOnly(true);

    expect(cellTexts()).toEqual([['Child', '']]);
  });

  it('puts a short id row\'s cell under its own column when a legacy string row is present', async () => {
    const data = {
      withHeadings: false,
      content: [
        [{ blocks: [], id: 'colA' }, { blocks: [], id: 'colB' }],
        ['p', 'q'],
        [{ blocks: [], id: 'colB', text: 'X' }],
      ],
    };

    await boot([{ id: 'start', type: 'paragraph', data: { text: '' } }]);
    editor?.blocks.insert('table', data);
    await nextFrame();

    expect(cellTexts()[2]).toEqual(['', 'X']);
    expect(blocksToHtml({ blocks: [{ id: 't', type: 'table', data }] })).toContain('<tr><td></td><td>X</td></tr>');
  });

  it('keeps a null first row as the empty heading row after a save', async () => {
    await boot([
      {
        id: 't',
        type: 'table',
        data: { withHeadings: true, content: [null, [{ blocks: ['x'] }]] },
        content: ['x'],
      },
      { id: 'x', type: 'paragraph', parent: 't', data: { text: 'X' } },
    ]);
    const saved = await editor?.save();
    const table = saved?.blocks.find(block => block.id === 't');

    expect(cellTexts()).toEqual([[''], ['X']]);
    expect(table?.data.content).toHaveLength(2);
  });
});
