/**
 * Row/column grip menu actions on a real editor must keep every cell's
 * blocks, text and formatting in the SAVED output and on screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import { Table } from '../../../../../src/tools/table/index';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { API, OutputBlockData, OutputData } from '../../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  history: { undo: () => void; redo: () => void };
  module: { yjsManager: { stopCapturing: () => void } };
}

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});
const frame = (): Promise<void> => new Promise(resolve => {
  requestAnimationFrame(() => resolve());
});
const flush = async (): Promise<void> => {
  await settle();
  await frame();
  await frame();
  await settle();
};

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const boot = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({ holder, tools: { paragraph: Paragraph, table: Table }, data: { blocks } }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await flush();
  instance.module.yjsManager.stopCapturing();

  return instance;
};

type Cell = { blocks: string[]; colspan?: number; rowspan?: number; mergedInto?: [number, number]; color?: string; textColor?: string; placement?: string };

const P = (id: string, text: string): OutputBlockData => ({ id, type: 'paragraph', data: { text }, parent: 'tbl' });

const doc = (content: Cell[][], texts: Record<string, string>, colWidths?: number[]): OutputBlockData[] => [
  {
    id: 'tbl',
    type: 'table',
    data: { withHeadings: false, content, ...(colWidths ? { colWidths } : {}) },
    content: Object.keys(texts),
  },
  ...Object.entries(texts).map(([id, text]) => P(id, text)),
  { id: 'after', type: 'paragraph', data: { text: 'after' } },
];

/** 3x3 grid, cell [1][1] holds two blocks and is painted. */
const plain = (): OutputBlockData[] => doc([
  [{ blocks: ['a'] }, { blocks: ['b'] }, { blocks: ['c'] }],
  [{ blocks: ['d'] }, { blocks: ['e1', 'e2'], color: '#ff0000', textColor: '#00ff00', placement: 'middle-center' }, { blocks: ['f'] }],
  [{ blocks: ['g'] }, { blocks: ['h'] }, { blocks: ['i'] }],
], { a: 'A', b: 'B', c: 'C', d: 'D', e1: 'E1', e2: 'E2', f: 'F', g: 'G', h: 'H', i: 'I' });

/** 3x3 grid, [0][0] spans two columns. */
const merged = (): OutputBlockData[] => doc([
  [{ blocks: ['a'], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }, { blocks: ['c'] }],
  [{ blocks: ['d'] }, { blocks: ['e1', 'e2'], color: '#ff0000' }, { blocks: ['f'] }],
  [{ blocks: ['g'] }, { blocks: ['h'] }, { blocks: ['i'] }],
], { a: 'A', c: 'C', d: 'D', e1: 'E1', e2: 'E2', f: 'F', g: 'G', h: 'H', i: 'I' });

const savedTable = (out: OutputData): { content: Cell[][] } =>
  out.blocks.find(b => b.id === 'tbl')?.data as { content: Cell[][] };

/** Saved text per cell ('' for an empty cell, '~' for a merge-covered slot). */
const savedTexts = (out: OutputData): string[][] => {
  const byId = new Map(out.blocks.map(b => [b.id, b] as const));

  return savedTable(out).content.map(row => row.map(cell => cell.mergedInto
    ? '~'
    : cell.blocks.map(id => {
      const block = byId.get(id);

      return block === undefined ? `<missing ${id}>` : String((block.data as { text?: string }).text ?? '');
    }).filter(t => t !== '').join('|')));
};

const gridEl = (): HTMLTableElement => {
  const el = holder?.querySelector<HTMLTableElement>('[data-blok-id="tbl"] table');

  if (!el) {
    throw new Error('no grid');
  }

  return el;
};

const visibleTexts = (): string[][] => Array.from(gridEl().tBodies[0].rows).map(r =>
  Array.from(r.cells).map(c => Array.from(c.querySelectorAll('[data-blok-id]')).map(b => (b.textContent ?? '').trim()).filter(t => t !== '').join('|')));

const menuAction = async (kind: 'row' | 'col', index: number, title: string, nth = 0): Promise<void> => {
  const grip = holder?.querySelector<HTMLElement>(`[data-blok-table-grip-${kind}="${index}"]`);

  if (!grip) {
    throw new Error(`no ${kind} grip ${index}`);
  }
  grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const items = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-popover-item]'))
    .filter(item => item.querySelector('[data-blok-popover-item-title]')?.textContent === title);
  const item = items[nth];

  if (!item) {
    throw new Error(`no "${title}" item in ${Array.from(document.querySelectorAll('[data-blok-popover-item]')).map(i => i.textContent).join(',')}`);
  }
  item.click();
  await flush();
};

describe('row/column grip actions keep cell data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    vi.restoreAllMocks();
  });

  it('duplicate row copies a two-block cell and its formatting', async () => {
    const instance = await boot(plain());

    await menuAction('row', 1, 'Duplicate');
    const out = await instance.save();

    expect(savedTexts(out)).toEqual([['A', 'B', 'C'], ['D', 'E1|E2', 'F'], ['D', 'E1|E2', 'F'], ['G', 'H', 'I']]);
    expect(savedTable(out).content[2][1]).toMatchObject({ color: '#ff0000', textColor: '#00ff00', placement: 'middle-center' });
    expect(visibleTexts()).toEqual(savedTexts(out));
  }, 30_000);

  it('duplicate column copies a two-block cell and its formatting', async () => {
    const instance = await boot(plain());

    await menuAction('col', 1, 'Duplicate');
    const out = await instance.save();

    expect(savedTexts(out)).toEqual([['A', 'B', 'B', 'C'], ['D', 'E1|E2', 'E1|E2', 'F'], ['G', 'H', 'H', 'I']]);
    expect(savedTable(out).content[1][2]).toMatchObject({ color: '#ff0000', textColor: '#00ff00', placement: 'middle-center' });
    expect(visibleTexts()).toEqual(savedTexts(out));
  }, 30_000);

  it('duplicate row on a merged grid copies the row below the merge', async () => {
    const instance = await boot(merged());

    await menuAction('row', 1, 'Duplicate');
    const out = await instance.save();

    expect(savedTexts(out)).toEqual([['A', '~', 'C'], ['D', 'E1|E2', 'F'], ['D', 'E1|E2', 'F'], ['G', 'H', 'I']]);
    expect(visibleTexts()).toEqual([['A', 'C'], ['D', 'E1|E2', 'F'], ['D', 'E1|E2', 'F'], ['G', 'H', 'I']]);
  }, 30_000);

  it('duplicate column on a merged grid copies every cell of the column', async () => {
    const instance = await boot(merged());

    await menuAction('col', 2, 'Duplicate');
    const out = await instance.save();

    expect(savedTexts(out)).toEqual([['A', '~', 'C', 'C'], ['D', 'E1|E2', 'F', 'F'], ['G', 'H', 'I', 'I']]);
  }, 30_000);

  it('duplicate row 0 through a merge keeps the merged origin text', async () => {
    const instance = await boot(merged());

    await menuAction('row', 0, 'Duplicate');
    const out = await instance.save();
    const texts = savedTexts(out);

    expect(texts[0]).toEqual(['A', '~', 'C']);
    expect(texts[1][0]).toBe('A');
    expect(texts[1][2]).toBe('C');
    expect(texts.slice(2)).toEqual([['D', 'E1|E2', 'F'], ['G', 'H', 'I']]);
  }, 30_000);

  it('insert row above/below and column left/right on a merged grid keep every cell', async () => {
    const instance = await boot(merged());

    await menuAction('row', 1, 'Insert row above');
    await menuAction('col', 2, 'Insert column left');
    const out = await instance.save();

    expect(savedTexts(out)).toEqual([
      ['A', '~', '', 'C'],
      ['', '', '', ''],
      ['D', 'E1|E2', '', 'F'],
      ['G', 'H', '', 'I'],
    ]);
    expect(visibleTexts()).toEqual([['A', '', 'C'], ['', '', '', ''], ['D', 'E1|E2', '', 'F'], ['G', 'H', '', 'I']]);
  }, 30_000);

  it('delete row 1 on a merged grid keeps the other rows', async () => {
    const instance = await boot(merged());

    await menuAction('row', 1, 'Delete');
    const out = await instance.save();

    expect(savedTexts(out)).toEqual([['A', '~', 'C'], ['G', 'H', 'I']]);
    expect(out.blocks.map(b => b.id)).not.toContain('e1');
  }, 30_000);

  it('delete column 1 through a merge keeps the merged text', async () => {
    const instance = await boot(merged());

    await menuAction('col', 1, 'Delete');
    const out = await instance.save();

    expect(savedTexts(out)).toEqual([['A', 'C'], ['D', 'F'], ['G', 'I']]);
  }, 30_000);

  it('delete column 0 (merge origin column) keeps the merged text in the surviving slot', async () => {
    const instance = await boot(merged());

    await menuAction('col', 0, 'Delete');
    const out = await instance.save();
    const texts = savedTexts(out);

    expect(texts).toEqual([['A', 'C'], ['E1|E2', 'F'], ['H', 'I']]);
  }, 30_000);

  it('undo of delete row restores the row text', async () => {
    const instance = await boot(plain());

    await menuAction('row', 1, 'Delete');
    instance.module.yjsManager.stopCapturing();
    instance.history.undo();
    await flush();
    const out = await instance.save();

    expect(savedTexts(out)).toEqual([['A', 'B', 'C'], ['D', 'E1|E2', 'F'], ['G', 'H', 'I']]);
    expect(savedTable(out).content[1][1]).toMatchObject({ color: '#ff0000' });
    expect(visibleTexts()).toEqual(savedTexts(out));
  }, 30_000);

  it('undo of delete column on a merged grid restores the merge and text', async () => {
    const instance = await boot(merged());

    await menuAction('col', 1, 'Delete');
    instance.module.yjsManager.stopCapturing();
    instance.history.undo();
    await flush();
    const out = await instance.save();

    expect(savedTexts(out)).toEqual([['A', '~', 'C'], ['D', 'E1|E2', 'F'], ['G', 'H', 'I']]);
    expect(savedTable(out).content[0][0].colspan).toBe(2);
  }, 30_000);

  it('undo of duplicate row removes only the copy', async () => {
    const instance = await boot(plain());

    await menuAction('row', 1, 'Duplicate');
    instance.module.yjsManager.stopCapturing();
    instance.history.undo();
    await flush();
    const out = await instance.save();

    expect(savedTexts(out)).toEqual([['A', 'B', 'C'], ['D', 'E1|E2', 'F'], ['G', 'H', 'I']]);
    expect(visibleTexts()).toEqual(savedTexts(out));
  }, 30_000);

  const stubGeometry = (): void => {
    const grid = gridEl();
    const rows = grid.tBodies[0].rows.length;

    Object.defineProperty(grid, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect(0, 0, 150, rows * 40) });
    Array.from(grid.tBodies[0].rows).forEach((row, index) => {
      Object.defineProperty(row, 'offsetTop', { configurable: true, value: index * 40 });
      Object.defineProperty(row, 'offsetHeight', { configurable: true, value: 40 });
    });
  };

  const drag = async (kind: 'row' | 'col', index: number, sx: number, sy: number, ex: number, ey: number): Promise<void> => {
    const handle = holder?.querySelector<HTMLElement>(`[data-blok-table-grip-${kind}="${index}"]`);

    if (!handle) {
      throw new Error(`no ${kind} grip ${index}`);
    }
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: sx, clientY: sy }));
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: ex, clientY: ey }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: ex, clientY: ey }));
    await flush();
  };

  it('dragging row 1 to the top keeps its two-block cell and formatting', async () => {
    const instance = await boot(plain());

    stubGeometry();
    await drag('row', 1, 0, 50, 0, 0);
    const out = await instance.save();

    expect(savedTexts(out)).toEqual([['D', 'E1|E2', 'F'], ['A', 'B', 'C'], ['G', 'H', 'I']]);
    expect(savedTable(out).content[0][1]).toMatchObject({ color: '#ff0000', textColor: '#00ff00', placement: 'middle-center' });
    expect(visibleTexts()).toEqual(savedTexts(out));
  }, 30_000);

  it('dragging column 1 to the left keeps its two-block cell and formatting', async () => {
    const instance = await boot(plain());

    stubGeometry();
    await drag('col', 1, 75, 0, 0, 0);
    const out = await instance.save();

    expect(savedTexts(out)).toEqual([['B', 'A', 'C'], ['E1|E2', 'D', 'F'], ['H', 'G', 'I']]);
    expect(savedTable(out).content[1][0]).toMatchObject({ color: '#ff0000', textColor: '#00ff00', placement: 'middle-center' });
    expect(visibleTexts()).toEqual(savedTexts(out));
  }, 30_000);

  it('undo of a row drag puts every cell back', async () => {
    const instance = await boot(plain());

    stubGeometry();
    await drag('row', 1, 0, 50, 0, 0);
    instance.module.yjsManager.stopCapturing();
    instance.history.undo();
    await flush();
    const out = await instance.save();

    expect(savedTexts(out)).toEqual([['A', 'B', 'C'], ['D', 'E1|E2', 'F'], ['G', 'H', 'I']]);
    expect(visibleTexts()).toEqual(savedTexts(out));
  }, 30_000);

  it('dragging row 2 above row 1 on a merged grid keeps every cell', async () => {
    const instance = await boot(merged());

    stubGeometry();
    await drag('row', 2, 0, 90, 0, 45);
    const out = await instance.save();

    expect(savedTexts(out)).toEqual([['A', '~', 'C'], ['G', 'H', 'I'], ['D', 'E1|E2', 'F']]);
    expect(visibleTexts()).toEqual([['A', 'C'], ['G', 'H', 'I'], ['D', 'E1|E2', 'F']]);
  }, 30_000);
});
