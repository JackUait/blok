/**
 * Data-loss hunt: Markdown text pasted into a cell of an existing table.
 * The Markdown paste handler (src/markdown/markdown-handler.ts) takes this
 * path, not the generic paste handler the plain-text control goes through.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { ListItem } from '../../../../../src/tools/list';
import { Table } from '../../../../../src/tools/table';
import { Callout, Header, Toggle } from '../../../../../src/tools';
import type { API, OutputBlockData, OutputData } from '../../../../../types';
import { settle } from './roundtrip-harness';

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  history: API['history'];
  caret: { setToBlock: (id: string, position: string) => boolean };
  blocks: { getCurrentBlockIndex: () => number; getBlockByIndex: (index: number) => { id: string } | undefined };
}

const CELL_IDS = [['c00', 'c01'], ['c10', 'c11']];

let holder: HTMLDivElement;
let editor: TestEditor | null = null;

/** `lastCell` replaces c11 (and may bring its own children). */
const bootTable = async (lastCell: OutputBlockData[] = []): Promise<TestEditor> => {
  const content = CELL_IDS.map(row => row.map(id => ({ blocks: [id] })));
  const cells: OutputBlockData[] = CELL_IDS.flat().map(id => ({ id, type: 'paragraph', data: { text: id === 'c00' ? 'keep' : '' }, parent: 't' }));
  const blocks = lastCell.length > 0 ? [...cells.filter(block => block.id !== 'c11'), ...lastCell] : cells;
  const instance = new Blok({
    holder,
    tools: { table: Table, paragraph: Paragraph, list: ListItem, header: Header, callout: Callout, toggle: Toggle },
    data: { blocks: [{ id: 't', type: 'table', data: { withHeadings: false, content } }, ...blocks] },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await settle();

  return instance;
};

/** Paste plain text with the caret in the bottom-right cell (c11). */
const pasteIntoLastCell = async (instance: TestEditor, plain: string, caretId = 'c11'): Promise<void> => {
  instance.caret.setToBlock(caretId, 'end');
  await settle();

  expect(instance.blocks.getBlockByIndex(instance.blocks.getCurrentBlockIndex())?.id).toBe(caretId);

  const target = holder.querySelector<HTMLElement>(`[data-blok-id="${caretId}"] [contenteditable="true"]`)
    ?? holder.querySelector<HTMLElement>(`[data-blok-id="${caretId}"] [data-blok-element-content] > *`);

  if (target === null) {
    throw new Error(`no ${caretId} editable`);
  }

  const event = new Event('paste', { bubbles: true, cancelable: true });

  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string): string => (type === 'text/plain' ? plain : ''), types: ['text/plain'] },
  });
  target.setAttribute('contenteditable', 'true');
  target.dispatchEvent(event);

  for (let i = 0; i < 6; i++) {
    await settle();
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};

const cellOf = (saved: OutputData, row: number, col: number): OutputBlockData[] => {
  const table = saved.blocks.find(block => block.id === 't');
  const ids = (table?.data.content as Array<Array<{ blocks: string[] }>>)[row][col].blocks;

  return ids.map(id => saved.blocks.find(block => block.id === id)).filter((block): block is OutputBlockData => block !== undefined);
};

const textsOf = (blocks: OutputBlockData[]): string[] => blocks.map(block => `${block.type}:${str(block.data.text)}`);

describe('markdown pasted into a table cell', { timeout: 60_000 }, () => {
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

  it('a markdown list lands in the cell the caret is in', async () => {
    const instance = await bootTable();

    await pasteIntoLastCell(instance, '- one\n- two');
    const saved = await instance.save();

    expect(textsOf(cellOf(saved, 1, 1))).toEqual(expect.arrayContaining(['list:one', 'list:two']));
    expect(textsOf(cellOf(saved, 0, 0))).toEqual(['paragraph:keep']);
  });

  it('a markdown heading never becomes a header block inside the table', async () => {
    const instance = await bootTable();

    await pasteIntoLastCell(instance, '# Title\n\nbody');
    const saved = await instance.save();

    expect(saved.blocks.filter(block => block.type === 'header' && block.parent === 't')).toEqual([]);
    expect(textsOf(cellOf(saved, 0, 0))).toEqual(['paragraph:keep']);
  });

  it('a markdown table never nests a table inside a cell', async () => {
    const instance = await bootTable();

    await pasteIntoLastCell(instance, '| A | B |\n| --- | --- |\n| 1 | 2 |');
    const saved = await instance.save();

    expect(saved.blocks.filter(block => block.type === 'table' && block.parent === 't')).toEqual([]);
    expect(textsOf(cellOf(saved, 0, 0))).toEqual(['paragraph:keep']);
  });

  it('a markdown heading leaves the table: saved after it at its level, mounted outside the grid', async () => {
    const instance = await bootTable();

    await pasteIntoLastCell(instance, '# Title\n\nbody');
    const saved = await instance.save();
    const header = saved.blocks.find(block => block.type === 'header');
    const ids = saved.blocks.map(block => block.id);

    expect(header?.parent).toBeUndefined();
    expect(ids.indexOf(header?.id)).toBeGreaterThan(ids.indexOf('c11'));
    expect(holder.querySelector(`[data-blok-id="${header?.id ?? ''}"]`)?.closest('[data-blok-tool="table"]')).toBeNull();
  });

  it('a markdown alert lands in the caret cell with its body still inside the callout', async () => {
    const instance = await bootTable();

    await pasteIntoLastCell(instance, '> [!NOTE]\n> inside');
    const saved = await instance.save();
    const cell = cellOf(saved, 1, 1);
    const callout = cell.find(block => block.type === 'callout');
    const body = saved.blocks.find(block => block.type === 'paragraph' && str(block.data.text) === 'inside');

    expect(callout).toBeDefined();
    expect(body?.parent).toBe(callout?.id);
    expect(textsOf(cellOf(saved, 0, 0))).toEqual(['paragraph:keep']);
  });

  it('a heading nested in a markdown alert still leaves the table', async () => {
    const instance = await bootTable();

    await pasteIntoLastCell(instance, '> [!NOTE]\n> # Title');
    const saved = await instance.save();
    const header = saved.blocks.find(block => block.type === 'header');

    expect(header).toBeDefined();
    expect(holder.querySelector(`[data-blok-id="${header?.id ?? ''}"]`)?.closest('[data-blok-tool="table"]')).toBeNull();
  });

  it('a markdown heading pasted in a callout body inside a cell leaves the table', async () => {
    const instance = await bootTable([
      { id: 'c11', type: 'callout', data: {}, parent: 't', content: ['cb'] },
      { id: 'cb', type: 'paragraph', data: { text: 'body' }, parent: 'c11' },
    ]);

    await pasteIntoLastCell(instance, '# Title\n\nmore', 'cb');
    const saved = await instance.save();
    const header = saved.blocks.find(block => block.type === 'header');

    expect(header).toBeDefined();
    expect(holder.querySelector(`[data-blok-id="${header?.id ?? ''}"]`)?.closest('[data-blok-tool="table"]')).toBeNull();
  });

  it('a markdown list pasted in a cell toggle title becomes the toggle children', async () => {
    const instance = await bootTable([
      { id: 'c11', type: 'toggle', data: { text: 'tog' }, parent: 't' },
    ]);

    await pasteIntoLastCell(instance, '- one\n- two');
    const saved = await instance.save();
    const items = saved.blocks.filter(block => block.type === 'list');

    expect(items.map(block => str(block.data.text))).toEqual(['one', 'two']);
    expect(items.map(block => block.parent)).toEqual(['c11', 'c11']);
  });

  describe('one undo removes the whole paste', () => {
    // Past the history capture window, so the paste is its own undo step.
    const CAPTURE = 700;
    const wait = (ms: number): Promise<void> => new Promise(resolve => {
      setTimeout(resolve, ms);
    });
    const cellIds = (saved: OutputData): string[][] => {
      const table = saved.blocks.find(block => block.id === 't');

      return (table?.data.content as Array<Array<{ blocks: string[] }>>).flat().map(cell => cell.blocks);
    };

    it('a markdown list pasted in a cell', async () => {
      const instance = await bootTable();
      const before = await instance.save();

      await wait(CAPTURE);
      await pasteIntoLastCell(instance, '- one\n- two');
      const pasted = await instance.save();

      expect(textsOf(cellOf(pasted, 1, 1))).toEqual(expect.arrayContaining(['list:one', 'list:two']));

      await wait(CAPTURE);
      instance.history.undo();
      await wait(300);
      const undone = await instance.save();

      expect(undone.blocks.filter(block => block.type === 'list')).toEqual([]);
      expect(cellIds(undone)).toEqual(cellIds(before));
      expect(textsOf(cellOf(undone, 0, 0))).toEqual(['paragraph:keep']);
    });

    it('a markdown heading sent out of the table', async () => {
      const instance = await bootTable();
      const before = await instance.save();

      await wait(CAPTURE);
      await pasteIntoLastCell(instance, '# Title\n\nbody');
      const pasted = await instance.save();

      expect(pasted.blocks.map(block => str(block.data.text))).toEqual(expect.arrayContaining(['Title', 'body']));

      await wait(CAPTURE);
      instance.history.undo();
      await wait(300);
      const undone = await instance.save();

      expect(undone.blocks.map(block => str(block.data.text))).not.toContain('Title');
      expect(undone.blocks.map(block => str(block.data.text))).not.toContain('body');
      expect(undone.blocks.map(block => block.id)).toEqual(before.blocks.map(block => block.id));
      expect(cellIds(undone)).toEqual(cellIds(before));
      expect(textsOf(cellOf(undone, 0, 0))).toEqual(['paragraph:keep']);
    });
  });

  it('control: plain multi-line text lands in the cell the caret is in', async () => {
    const instance = await bootTable();

    await pasteIntoLastCell(instance, 'one\ntwo');
    const saved = await instance.save();

    expect(textsOf(cellOf(saved, 1, 1))).toEqual(['paragraph:', 'paragraph:one', 'paragraph:two']);
    expect(textsOf(cellOf(saved, 0, 0))).toEqual(['paragraph:keep']);
  });
});
