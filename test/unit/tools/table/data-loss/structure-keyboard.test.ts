/**
 * Backspace / Delete / Enter at cell and table boundaries must never move or
 * drop cell text.
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
  await settle(50);
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

type Cell = { blocks: string[] };

const doc = (): OutputBlockData[] => [
  { id: 'top', type: 'paragraph', data: { text: 'Top' } },
  {
    id: 'tbl',
    type: 'table',
    data: {
      withHeadings: false,
      content: [
        [{ blocks: ['a'] }, { blocks: ['b'] }],
        [{ blocks: ['c1', 'c2'] }, { blocks: ['d'] }],
      ],
    },
    content: ['a', 'b', 'c1', 'c2', 'd'],
  },
  { id: 'a', type: 'paragraph', data: { text: 'A' }, parent: 'tbl' },
  { id: 'b', type: 'paragraph', data: { text: 'B' }, parent: 'tbl' },
  { id: 'c1', type: 'paragraph', data: { text: 'C1' }, parent: 'tbl' },
  { id: 'c2', type: 'paragraph', data: { text: 'C2' }, parent: 'tbl' },
  { id: 'd', type: 'paragraph', data: { text: 'D' }, parent: 'tbl' },
  { id: 'after', type: 'paragraph', data: { text: 'After' } },
];

const savedTexts = (out: OutputData): string[][] => {
  const byId = new Map(out.blocks.map(b => [b.id, b] as const));
  const content = (out.blocks.find(b => b.id === 'tbl')?.data as { content: Cell[][] }).content;

  return content.map(row => row.map(cell => cell.blocks
    .map(id => String((byId.get(id)?.data as { text?: string } | undefined)?.text ?? `<missing ${id}>`))
    .filter(t => t !== '').join('|')));
};

const rootTexts = (out: OutputData): string[] => out.blocks
  .filter(b => b.parent === undefined && b.type === 'paragraph')
  .map(b => String((b.data as { text: string }).text));

const allText = (out: OutputData): string => out.blocks.map(b => String((b.data as { text?: string }).text ?? '')).join(' ');

const editableOf = (id: string): HTMLElement => {
  const blockHolder = holder?.querySelector<HTMLElement>(`[data-blok-id="${id}"]`);
  const editable = Array.from(blockHolder?.querySelectorAll<HTMLElement>('*') ?? [])
    .find(element => element.contentEditable === 'true' && element.closest('[data-blok-id]') === blockHolder);

  if (editable === undefined) {
    throw new Error(`no editable for ${id}`);
  }

  return editable;
};

const press = async (id: string, key: string, at: 'start' | 'end'): Promise<void> => {
  const editable = editableOf(id);
  const range = document.createRange();

  // jsdom does not reflect the contentEditable property as an attribute.
  holder?.querySelectorAll<HTMLElement>('*').forEach(el => {
    if (el.contentEditable === 'true') {
      el.setAttribute('contenteditable', 'true');
    }
  });
  editable.focus();
  if (document.activeElement !== editable) {
    throw new Error(`focus did not land in ${id}`);
  }
  if (at === 'start') {
    range.setStart(editable.firstChild ?? editable, 0);
  } else {
    const last = editable.lastChild ?? editable;

    range.setStart(last, last.nodeType === Node.TEXT_NODE ? (last.textContent ?? '').length : last.childNodes.length);
  }
  range.collapse(true);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  editable.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  await flush();
};

describe('keyboard at table boundaries keeps cell data', () => {
  it('control: Backspace at the start of a cell\'s second block merges it into the first', async () => {
    const instance = await boot(doc());

    await press('c2', 'Backspace', 'start');
    const out = await instance.save();

    expect(savedTexts(out)).toEqual([['A', 'B'], ['C1C2', 'D']]);
  }, 30_000);

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

  it('Backspace at the start of a cell\'s first block does not merge into the previous cell', async () => {
    const instance = await boot(doc());

    await press('b', 'Backspace', 'start');
    const out = await instance.save();

    expect(savedTexts(out)).toEqual([['A', 'B'], ['C1|C2', 'D']]);
  }, 30_000);

  it('Backspace at the start of the first cell keeps the table and the text above', async () => {
    const instance = await boot(doc());

    await press('a', 'Backspace', 'start');
    const out = await instance.save();

    expect(savedTexts(out)).toEqual([['A', 'B'], ['C1|C2', 'D']]);
    expect(rootTexts(out)).toEqual(['Top', 'After']);
  }, 30_000);

  it('Delete at the end of a cell\'s last block does not merge the next cell into it', async () => {
    const instance = await boot(doc());

    await press('a', 'Delete', 'end');
    const out = await instance.save();

    expect(savedTexts(out)).toEqual([['A', 'B'], ['C1|C2', 'D']]);
  }, 30_000);

  it('Delete at the end of the last cell keeps the paragraph after the table', async () => {
    const instance = await boot(doc());

    await press('d', 'Delete', 'end');
    const out = await instance.save();

    expect(allText(out)).toContain('After');
    expect(savedTexts(out)[0]).toEqual(['A', 'B']);
  }, 30_000);

  it('Delete at the end of the paragraph above the table keeps every cell', async () => {
    const instance = await boot(doc());

    await press('top', 'Delete', 'end');
    const out = await instance.save();

    expect(savedTexts(out)).toEqual([['A', 'B'], ['C1|C2', 'D']]);
    expect(rootTexts(out)).toContain('Top');
  }, 30_000);

  it('Backspace at the start of the paragraph below the table keeps its text', async () => {
    const instance = await boot(doc());

    await press('after', 'Backspace', 'start');
    const out = await instance.save();

    expect(allText(out)).toContain('After');
    expect(savedTexts(out)[0]).toEqual(['A', 'B']);
  }, 30_000);

});
