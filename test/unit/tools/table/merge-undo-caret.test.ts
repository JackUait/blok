/**
 * Undo of a cell merge puts the caret back where it was before the merge.
 * The merge moves cell blocks inside one transact, so no move entry records
 * the caret: the step's own caret entry must.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../src/blok';
import { Table } from '../../../../src/tools/table/index';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { LegacyCellContent } from '../../../../src/tools/table/types';
import type { OutputBlockData, OutputData } from '../../../../types';

const TABLE_ID = 'tbl';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  history: { undo: () => void; redo: () => void };
}

let holder: HTMLDivElement;
let blok: TestEditor | null = null;

const sleep = (ms: number): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, ms);
});

/** Past the history capture window. */
const CAPTURE = 700;

const merge = (fromId: string, toId: string): void => {
  const cellFor = (id: string): HTMLElement | null =>
    holder.querySelector(`[data-blok-id="${id}"]`)?.closest<HTMLElement>('[data-blok-table-cell]') ?? null;
  const from = cellFor(fromId);
  const to = cellFor(toId);

  if (from === null || to === null) {
    throw new Error('no cell for merge');
  }

  from.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
  const priorElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');

  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => to });
  try {
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 1, clientY: 1 }));
  } finally {
    if (priorElementFromPoint === undefined) {
      Reflect.deleteProperty(document, 'elementFromPoint');
    } else {
      Object.defineProperty(document, 'elementFromPoint', priorElementFromPoint);
    }
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  }

  const pill = holder.querySelector<HTMLElement>('[data-blok-table-selection-pill]');

  if (pill === null) {
    throw new Error('no selection menu');
  }
  pill.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
  pill.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));

  const mergeItem = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-popover-item]'))
    .find(item => item.querySelector('[data-blok-popover-item-title]')?.textContent === 'Merge cells');

  if (mergeItem === undefined) {
    throw new Error('no Merge cells item');
  }
  mergeItem.click();
};

const boot = async (): Promise<TestEditor> => {
  const content: LegacyCellContent[][] = [
    [{ blocks: ['a'] }, { blocks: ['b'] }],
    [{ blocks: ['c'] }, { blocks: ['d'] }],
  ];
  const cells: OutputBlockData[] = ['a', 'b', 'c', 'd'].map(id => ({
    id, type: 'paragraph', data: { text: id.toUpperCase() }, parent: TABLE_ID,
  }));
  const data: OutputData = {
    blocks: [{ id: TABLE_ID, type: 'table', data: { withHeadings: false, withHeadingColumn: false, content } }, ...cells],
  };
  const instance = new Blok({ holder, tools: { paragraph: Paragraph, table: Table }, data }) as unknown as TestEditor;

  blok = instance;
  await instance.isReady;
  await sleep(CAPTURE);

  return instance;
};

const putCaret = (blockId: string, offset: number): void => {
  const editable = holder.querySelector<HTMLElement>(`[data-blok-id="${blockId}"] [data-blok-element-content] > *`);
  const text = editable?.firstChild ?? null;

  if (editable === null || text === null) {
    throw new Error(`no text in ${blockId}`);
  }
  editable.setAttribute('contenteditable', 'true');
  editable.focus();
  const range = document.createRange();

  range.setStart(text, offset);
  range.collapse(true);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
};

/** The block holding the caret. */
const caretBlock = (): string | null => {
  const node = window.getSelection()?.anchorNode ?? null;
  const element = node instanceof Element ? node : node?.parentElement ?? null;

  return element?.closest('[data-blok-id]')?.getAttribute('data-blok-id') ?? null;
};

/** `text@offset` of the caret, when it sits in a text node. */
const caretText = (): string => {
  const selection = window.getSelection();
  const node = selection?.anchorNode ?? null;

  return node instanceof Text ? `${node.data}@${selection?.anchorOffset ?? -1}` : `${node?.nodeName ?? 'none'}@${selection?.anchorOffset ?? -1}`;
};

describe('undo of a cell merge restores the caret', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    blok?.destroy();
    blok = null;
    holder.remove();
    vi.restoreAllMocks();
  });

  it.each(['b', 'd'])('caret in %s before the merge is back in %s after undo', async (id) => {
    const editor = await boot();

    putCaret(id, 1);
    await sleep(50);
    merge(id, id === 'b' ? 'c' : 'a');
    await sleep(CAPTURE);
    expect(holder.querySelector<HTMLTableCellElement>('[data-blok-table-cell]')?.colSpan).toBe(2);

    editor.history.undo();

    expect(caretBlock()).toBe(id);
    expect(document.activeElement?.closest('[data-blok-id]')?.getAttribute('data-blok-id')).toBe(id);
  }, 90_000);

  // jsdom resets the text range on focus; Chrome keeps the requested offset.
  it.fails('undo of a merge restores the caret offset', async () => {
    const editor = await boot();

    putCaret('b', 1);
    await sleep(50);
    merge('b', 'c');
    await sleep(CAPTURE);
    expect(holder.querySelector<HTMLTableCellElement>('[data-blok-table-cell]')?.colSpan).toBe(2);

    editor.history.undo();

    expect(caretText()).toBe('B@1');
  }, 90_000);
});
