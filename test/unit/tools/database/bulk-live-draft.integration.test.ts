import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { OutputBlockData, OutputData } from '../../../../types';

/** research/35:234-235: a board or list Text bulk edit shows each key on every picked card or row. */

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
}

const quiet = async (): Promise<void> => {
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
};

const doc = (view: Record<string, unknown>): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      schema: [
        { id: 't', name: 'Name', type: 'title', position: 'a0' },
        { id: 's', name: 'Status', type: 'select', position: 'a1', config: { options: [{ id: 'o1', label: 'Todo', position: 'a0' }] } },
        { id: 'notes', name: 'Notes', type: 'text', position: 'a2' },
      ],
      views: [{ id: 'v', name: 'View', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['s', 'notes'], ...view }],
      activeViewId: 'v',
    },
    content: ['r1', 'r2', 'r3'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'Alpha', s: 'o1', notes: 'alpha' }, position: 'a0' } },
  { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Bravo', s: 'o1', notes: 'beta' }, position: 'a1' } },
  { id: 'r3', type: 'database-row', parent: 'db', data: { properties: { t: 'Charlie', s: 'o1' }, position: 'a2' } },
];

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (blocks: OutputBlockData[]): Promise<void> => {
  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      database: DatabaseTool,
      'database-row': DatabaseRowTool,
    },
    data: { blocks },
  } as never) as unknown as TestEditor;
  await editor.isReady;
  await quiet();
};

const q = <T extends Element = HTMLElement>(selector: string): T | null => holder?.querySelector<T>(selector) ?? null;

const click = async (el: Element | null, init: MouseEventInit = {}): Promise<void> => {
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));
  await quiet();
};

const saved = async (rowId: string): Promise<unknown> =>
  ((await editor?.save())?.blocks.find((block) => block.id === rowId)?.data as { properties?: Record<string, unknown> } | undefined)?.properties?.notes;

const VIEWS = [
  ['board', { type: 'board', groupBy: 's' }, '[data-blok-database-card]', '[data-blok-database-card-property]'],
  ['list', { type: 'list' }, '[data-blok-database-list-row]', '[data-blok-database-list-row-property]'],
] as const;

const notesShown = (rowSelector: string, propertySelector: string, rowId: string): string | null =>
  q(`${rowSelector}[data-row-id="${rowId}"] ${propertySelector}[data-property-id="notes"]`)?.textContent?.trim() ?? null;

const textField = (): HTMLTextAreaElement => {
  const field = document.querySelector<HTMLTextAreaElement>('[data-blok-database-cell-input]');

  if (field === null) throw new Error('no text field');

  return field;
};

const openNotesOn = async (rowSelector: string): Promise<void> => {
  for (const rowId of ['r1', 'r2', 'r3']) {
    await click(q(`${rowSelector}[data-row-id="${rowId}"]`), { metaKey: true });
  }
  await click(q('[data-blok-database-table-selection-property][data-property-id="notes"]'));
  textField();
};

const type = async (value: string): Promise<void> => {
  const field = textField();

  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  await quiet();
};

describe('board and list Text bulk edit: live draft (research/35:234-235)', () => {
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
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it.each(VIEWS)('%s: each key shows on every picked item, an empty one too, before anything is written', async (_name, view, rowSelector, propertySelector) => {
    await make(doc(view));
    await openNotesOn(rowSelector);
    await type('alphaX');

    expect(['r1', 'r2', 'r3'].map((rowId) => notesShown(rowSelector, propertySelector, rowId))).toEqual(['alphaX', 'alphaX', 'alphaX']);
    expect(await saved('r2')).toBe('beta');
  }, 30_000);

  it.each(VIEWS)('%s: closing with nothing written puts every item back', async (_name, view, rowSelector, propertySelector) => {
    await make(doc(view));
    await openNotesOn(rowSelector);
    await type('alphaX');
    await type('alpha');
    textField().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await quiet();

    expect(['r1', 'r2', 'r3'].map((rowId) => notesShown(rowSelector, propertySelector, rowId))).toEqual(['alpha', 'beta', null]);
    expect(await saved('r2')).toBe('beta');
  }, 30_000);
});
