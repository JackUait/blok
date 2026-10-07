/**
 * Shared harness for the undo/redo table data-loss probes: a real Blok with
 * the real Table and Paragraph tools, driven through DOM events.
 */
import { vi } from 'vitest';

import Blok from '../../../../../src/blok';
import { Table } from '../../../../../src/tools/table/index';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { ListItem } from '../../../../../src/tools/list';
import { ToggleItem } from '../../../../../src/tools/toggle';
import type { CellContent, LegacyCellContent, TableData } from '../../../../../src/tools/table/types';
import type { API, OutputBlockData, OutputData } from '../../../../../types';
import { htmlOf } from '../../../helpers/saved-as-html';

export const TABLE_ID = 'tbl';
/** Past the history capture window so the prior step is its own entry. */
export const CAPTURE = 700;

export interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  history: API['history'];
  blocks: API['blocks'];
  readOnly: API['readOnly'];
  module: {
    yjsManager: {
      toJSON: () => OutputBlockData[];
      getBlockDataObject: (id: string) => Record<string, unknown> | undefined;
      onPendingBlockWritesSettled: (callback: () => void) => () => void;
    };
  };
}

export const h: { holder: HTMLDivElement; blok: TestEditor | null } = {
  holder: document.createElement('div'),
  blok: null,
};

export const sleep = (ms: number): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, ms);
});

export const setup = (): void => {
  vi.clearAllMocks();
  h.holder = document.createElement('div');
  document.body.appendChild(h.holder);
};

export const teardown = (): void => {
  vi.unstubAllEnvs();
  h.blok?.destroy();
  h.blok = null;
  h.holder.remove();
  vi.restoreAllMocks();
};

export const buildDoc = (
  content: LegacyCellContent[][] | string[][],
  texts: Record<string, string>,
  extra: Partial<Record<string, unknown>> = {}
): OutputData => {
  const table: OutputBlockData = {
    id: TABLE_ID,
    type: 'table',
    data: { withHeadings: false, withHeadingColumn: false, content, ...extra },
  };
  const cells: OutputBlockData[] = Object.entries(texts).map(([id, text]) => ({
    id, type: 'paragraph', data: { text }, parent: TABLE_ID,
  }));

  return { blocks: [table, ...cells] };
};

export const boot = async (data: OutputData): Promise<TestEditor> => {
  const instance = new Blok({
    holder: h.holder,
    tools: { paragraph: Paragraph, table: Table, list: ListItem, toggle: ToggleItem },
    data,
  }) as unknown as TestEditor;

  h.blok = instance;
  await instance.isReady;
  await sleep(CAPTURE);

  return instance;
};

export const contentOf = (output: OutputData): CellContent[][] => {
  const table = output.blocks.find(b => b.id === TABLE_ID);

  return (table?.data as TableData | undefined)?.content as CellContent[][];
};

export const tableDataOf = (output: OutputData): TableData | undefined =>
  output.blocks.find(b => b.id === TABLE_ID)?.data as TableData | undefined;

const htmlTextOf = (block: OutputBlockData): string => {
  const text = htmlOf((block.data as { text?: unknown }).text);

  return typeof text === 'string' ? text : '';
};

const textById = (output: OutputData): Map<string, string> => new Map(output.blocks.map(b => [
  b.id ?? '',
  htmlTextOf(b),
]));

/** Saved texts per cell, row-major: what a reader of the saved JSON sees. */
export const savedCellTexts = (output: OutputData): string[][] => {
  const texts = textById(output);

  return contentOf(output).map(row => row.map(cell => {
    if (typeof cell === 'string') {
      return cell;
    }

    return (cell.blocks ?? []).map(id => texts.get(id) ?? `<missing:${id}>`).join('|');
  }));
};

/** Visible texts per rendered cell, keyed "row,col". */
export const domCellTexts = (): Record<string, string> => {
  const tableEl = h.holder.querySelector(`[data-blok-id="${TABLE_ID}"]`);
  const out: Record<string, string> = {};

  Array.from(tableEl?.querySelectorAll<HTMLElement>('[data-blok-table-cell]') ?? []).forEach(td => {
    const key = `${td.getAttribute('data-blok-table-cell-row') ?? '?'},${td.getAttribute('data-blok-table-cell-col') ?? '?'}`;
    const holders = Array.from(td.querySelectorAll<HTMLElement>('[data-blok-id]'));

    out[key] = holders
      .filter(el => el.parentElement?.closest('[data-blok-table-cell]') === td && el.parentElement?.hasAttribute('data-blok-table-cell-blocks'))
      .map(el => el.querySelector('[data-blok-element-content]')?.textContent ?? '').join('|');
  });

  return out;
};

export const typeInto = async (blockId: string, text: string): Promise<void> => {
  const editable = h.holder.querySelector<HTMLElement>(`[data-blok-id="${blockId}"] [data-blok-element-content] > *`);

  if (editable === null) {
    throw new Error(`no editable for ${blockId}`);
  }
  editable.setAttribute('contenteditable', 'true');
  editable.focus();
  editable.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: text }));
  editable.textContent = text;
  editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  await sleep(50);
};

const ownGrip = (kind: 'row' | 'col', index: number): HTMLElement => {
  const wrapper = h.holder.querySelector(`[data-blok-id="${TABLE_ID}"] [data-blok-tool="table"]`)
    ?? h.holder.querySelector('[data-blok-tool="table"]');
  const grip = Array.from(wrapper?.querySelectorAll<HTMLElement>(`[data-blok-table-grip-${kind}="${index}"]`) ?? [])[0];

  if (grip === undefined) {
    throw new Error(`no ${kind} grip ${index}`);
  }

  return grip;
};

export const clickPopoverItem = (title: string): void => {
  const item = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-popover-item]'))
    .find(candidate => candidate.querySelector('[data-blok-popover-item-title]')?.textContent === title);

  if (item === undefined) {
    const seen = Array.from(document.querySelectorAll('[data-blok-popover-item-title]')).map(e => e.textContent);

    throw new Error(`no ${title} item; saw ${JSON.stringify(seen)}`);
  }
  item.click();
};

/** Open a row/column grip menu (keyboard path) and pick an item. */
export const gripAction = (kind: 'row' | 'col', index: number, title: string): void => {
  const grip = ownGrip(kind, index);

  grip.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
  clickPopoverItem(title);
};

export const cellAt = (row: number, col: number): HTMLTableCellElement => {
  const cell = Array.from(h.holder.querySelectorAll<HTMLTableCellElement>(`[data-blok-id="${TABLE_ID}"] [data-blok-table-cell]`))
    .find(td => {
      const r = Number(td.getAttribute('data-blok-table-cell-row'));
      const c = Number(td.getAttribute('data-blok-table-cell-col'));

      return row >= r && row < r + td.rowSpan && col >= c && col < c + td.colSpan;
    });

  if (cell === undefined) {
    throw new Error(`no cell at ${row},${col}`);
  }

  return cell;
};

const restoreElementFromPoint = (prior: PropertyDescriptor | undefined): void => {
  if (prior === undefined) {
    Reflect.deleteProperty(document, 'elementFromPoint');
  } else {
    Object.defineProperty(document, 'elementFromPoint', prior);
  }
};

/** Drag-select a cell rectangle the way the pointer does. */
export const selectCells = (from: [number, number], to: [number, number]): void => {
  const start = cellAt(...from);
  const end = cellAt(...to);

  start.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
  if (start !== end) {
    const prior = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');

    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => end });
    try {
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 1, clientY: 1 }));
    } finally {
      restoreElementFromPoint(prior);
    }
  }
  document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
};

export const selectionAction = (from: [number, number], to: [number, number], title: string): void => {
  selectCells(from, to);
  const pill = h.holder.querySelector<HTMLElement>('[data-blok-table-selection-pill]');

  if (pill === null) {
    throw new Error('no selection menu');
  }
  pill.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
  pill.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
  clickPopoverItem(title);
};

export const undo = async (editor: TestEditor, ms = 300): Promise<void> => {
  editor.history.undo();
  await sleep(ms);
};

export const redo = async (editor: TestEditor, ms = 300): Promise<void> => {
  editor.history.redo();
  await sleep(ms);
};

export const STD_2X2: LegacyCellContent[][] = [
  [{ blocks: ['a'] }, { blocks: ['b'] }],
  [{ blocks: ['c'] }, { blocks: ['d'] }],
];
export const STD_TEXTS = { a: 'A', b: 'B', c: 'C', d: 'D' };

export const settle = async (editor: TestEditor): Promise<void> => {
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  await new Promise<void>(resolve => editor.module.yjsManager.onPendingBlockWritesSettled(resolve));
};

/** The Yjs document as plain output blocks (what peers and a reload see). */
export const yjsDoc = async (editor: TestEditor): Promise<OutputData> => {
  await settle(editor);

  return { blocks: editor.module.yjsManager.toJSON() };
};

/** Every block id in the Yjs doc, sorted. */
export const yjsIds = async (editor: TestEditor): Promise<string[]> =>
  (await yjsDoc(editor)).blocks.map(b => b.id ?? '').sort();

/** Destroy, boot from the saved output, save again. */
export const reload = async (editor: TestEditor): Promise<{ editor: TestEditor; saved: OutputData }> => {
  const saved = await editor.save();

  editor.destroy();
  h.blok = null;
  h.holder.innerHTML = '';
  const next = await boot(saved);

  return { editor: next, saved: await next.save() };
};

/** Saved table content, cell texts and ids vs what the Yjs doc holds. */
export const consistency = async (editor: TestEditor): Promise<{
  savedTexts: string[][];
  yjsTexts: string[][];
  savedIds: string[];
  yjsIds: string[];
}> => {
  const doc = await yjsDoc(editor);
  const saved = await editor.save();

  return {
    savedTexts: savedCellTexts(saved),
    yjsTexts: savedCellTexts(doc),
    savedIds: saved.blocks.map(b => b.id ?? '').sort(),
    yjsIds: doc.blocks.map(b => b.id ?? '').sort(),
  };
};

/** Every block as "id:type:parent:text", sorted — catches loss at any depth. */
export const blockFacts = (output: OutputData): string[] => output.blocks.map(b =>
  `${b.id ?? ''}:${b.type}:${b.parent ?? ''}:${htmlTextOf(b)}`
).sort();

export const pasteHtml = (target: HTMLElement, html: string): void => {
  const data: Record<string, string> = { 'text/html': html, 'text/plain': html.replace(/<[^>]+>/g, ' ') };
  const event = new Event('paste', { bubbles: true, cancelable: true });

  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string): string => data[type] ?? '', types: Object.keys(data) },
  });
  target.setAttribute('contenteditable', 'true');
  target.focus();
  target.dispatchEvent(event);
};

export const editableOf = (blockId: string): HTMLElement => {
  const el = h.holder.querySelector<HTMLElement>(`[data-blok-id="${blockId}"] [data-blok-element-content] > *`);

  if (el === null) {
    throw new Error(`no editable for ${blockId}`);
  }

  return el;
};

/** Open row 0's grip menu and flip the "Header row" switch. */
export const toggleHeaderRow = (): void => {
  const grip = h.holder.querySelector<HTMLElement>('[data-blok-table-grip-row="0"]');

  if (grip === null) {
    throw new Error('no row grip 0');
  }
  grip.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
  const toggle = Array.from(document.querySelectorAll<HTMLElement>('[role="switch"]'))
    .find(el => el.textContent?.includes('Header row'));

  if (toggle === undefined) {
    throw new Error('no Header row switch');
  }
  toggle.click();
  document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
};
