/**
 * Cell-selection gestures (merge, split, clear) on a real editor must keep
 * every cell's text in the save and on screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import type { Block } from '../../../../../src/components/block';
import { Table } from '../../../../../src/tools/table/index';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { API, OutputBlockData, OutputData } from '../../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  history: { undo: () => void; redo: () => void };
  module: { blockManager: { blocks: Block[] }; yjsManager: { stopCapturing: () => void } };
}

interface Range { minRow: number; maxRow: number; minCol: number; maxCol: number }
interface Selection { selectRange: (r: Range) => void }

const settle = (ms = 0): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, ms);
});
const frame = (): Promise<void> => new Promise(resolve => {
  requestAnimationFrame(() => resolve());
});
const flush = async (): Promise<void> => {
  await settle();
  await frame();
  await frame();
  await settle(20);
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

type Cell = { blocks: string[]; colspan?: number; rowspan?: number; mergedInto?: [number, number] };

const doc = (content: Cell[][], texts: Record<string, string>): OutputBlockData[] => [
  { id: 'tbl', type: 'table', data: { withHeadings: false, content }, content: Object.keys(texts) },
  ...Object.entries(texts).map(([id, text]) => ({ id, type: 'paragraph', data: { text }, parent: 'tbl' })),
  { id: 'after', type: 'paragraph', data: { text: 'after' } },
];

const grid3 = (): OutputBlockData[] => doc([
  [{ blocks: ['a'] }, { blocks: ['b'] }, { blocks: ['c'] }],
  [{ blocks: ['d'] }, { blocks: ['e'] }, { blocks: ['f'] }],
  [{ blocks: ['g'] }, { blocks: ['h'] }, { blocks: ['i'] }],
], { a: 'A', b: 'B', c: 'C', d: 'D', e: 'E', f: 'F', g: 'G', h: 'H', i: 'I' });

const savedTexts = (out: OutputData): string[][] => {
  const byId = new Map(out.blocks.map(b => [b.id, b] as const));
  const content = (out.blocks.find(b => b.id === 'tbl')?.data as { content: Cell[][] }).content;

  return content.map(row => row.map(cell => cell.mergedInto ? '~' : cell.blocks
    .map(id => String((byId.get(id)?.data as { text?: string } | undefined)?.text ?? `<missing ${id}>`))
    .filter(t => t !== '').join('|')));
};

const visibleTexts = (): string[][] => {
  const grid = holder?.querySelector<HTMLTableElement>('[data-blok-id="tbl"] table');

  return Array.from(grid?.tBodies[0].rows ?? []).map(r => Array.from(r.cells).map(c =>
    Array.from(c.querySelectorAll('[data-blok-id]')).map(b => (b.textContent ?? '').trim()).filter(t => t !== '').join('|')));
};

const selectionOf = (instance: TestEditor): Selection => {
  const block = instance.module.blockManager.blocks.find(b => b.id === 'tbl');
  const tool = (block as unknown as { toolInstance: { subsystems: { cellSelectionSubsystem: Selection | null } } }).toolInstance;
  const selection = tool.subsystems.cellSelectionSubsystem;

  if (selection === null) {
    throw new Error('no cell selection');
  }

  return selection;
};

const pillAction = async (title: string): Promise<void> => {
  const pill = holder?.querySelector<HTMLElement>('[data-blok-table-selection-pill]') ?? document.querySelector<HTMLElement>('[data-blok-table-selection-pill]');

  if (!pill) {
    throw new Error('no pill');
  }
  pill.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  await flush();
  const item = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-popover-item]'))
    .find(el => el.querySelector('[data-blok-popover-item-title]')?.textContent === title);

  if (!item) {
    throw new Error(`no "${title}" in ${Array.from(document.querySelectorAll('[data-blok-popover-item]')).map(i => i.textContent).join(',')}`);
  }
  item.click();
  await flush();
};

describe('cell selection gestures keep cell data', () => {
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

  it('merging a 2x2 block of filled cells keeps all four texts', async () => {
    const instance = await boot(grid3());

    selectionOf(instance).selectRange({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
    await pillAction('Merge cells');
    const out = await instance.save();
    const merged = savedTexts(out)[0][0].split('|').sort();

    expect(merged).toEqual(['A', 'B', 'D', 'E']);
    expect(savedTexts(out)[2]).toEqual(['G', 'H', 'I']);
    expect(visibleTexts()[0][0].split('|').sort()).toEqual(['A', 'B', 'D', 'E']);
  }, 30_000);

  it('merge then split keeps all four texts', async () => {
    const instance = await boot(grid3());

    selectionOf(instance).selectRange({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
    await pillAction('Merge cells');
    selectionOf(instance).selectRange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });
    await pillAction('Split cell');
    const out = await instance.save();

    expect(savedTexts(out).flat().join('|').split('|').filter(t => t !== '').sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']);
  }, 30_000);

  it('undo of a merge restores each text to its own cell', async () => {
    const instance = await boot(grid3());

    selectionOf(instance).selectRange({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
    await pillAction('Merge cells');
    instance.module.yjsManager.stopCapturing();
    instance.history.undo();
    await flush();
    const out = await instance.save();

    expect(savedTexts(out)).toEqual([['A', 'B', 'C'], ['D', 'E', 'F'], ['G', 'H', 'I']]);
    expect(visibleTexts()).toEqual([['A', 'B', 'C'], ['D', 'E', 'F'], ['G', 'H', 'I']]);
  }, 30_000);

  it('Backspace on a multi-cell selection clears only those cells and keeps the merge elsewhere', async () => {
    const instance = await boot(doc([
      [{ blocks: ['a'], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }, { blocks: ['c'] }],
      [{ blocks: ['d'] }, { blocks: ['e'] }, { blocks: ['f'] }],
    ], { a: 'A', c: 'C', d: 'D', e: 'E', f: 'F' }));

    selectionOf(instance).selectRange({ minRow: 1, maxRow: 1, minCol: 0, maxCol: 1 });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    await flush();
    const out = await instance.save();

    expect(savedTexts(out)).toEqual([['A', '~', 'C'], ['', '', 'F']]);
  }, 30_000);

  it('undo of a multi-cell clear brings the text back', async () => {
    const instance = await boot(grid3());

    selectionOf(instance).selectRange({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 2 });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    await flush();
    instance.module.yjsManager.stopCapturing();
    instance.history.undo();
    await flush();
    const out = await instance.save();

    expect(savedTexts(out)).toEqual([['A', 'B', 'C'], ['D', 'E', 'F'], ['G', 'H', 'I']]);
    expect(visibleTexts()).toEqual([['A', 'B', 'C'], ['D', 'E', 'F'], ['G', 'H', 'I']]);
  }, 30_000);

  it('merging a selection that contains an existing merge keeps every text', async () => {
    const instance = await boot(doc([
      [{ blocks: ['a'], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }, { blocks: ['c'] }],
      [{ blocks: ['d'] }, { blocks: ['e'] }, { blocks: ['f'] }],
    ], { a: 'A', c: 'C', d: 'D', e: 'E', f: 'F' }));

    selectionOf(instance).selectRange({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 2 });
    await pillAction('Merge cells');
    const out = await instance.save();

    expect(savedTexts(out)[0][0].split('|').sort()).toEqual(['A', 'C', 'D', 'E', 'F']);
  }, 30_000);
});
