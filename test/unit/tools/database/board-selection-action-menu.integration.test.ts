import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { OutputBlockData, OutputData } from '../../../../types';

/**
 * notion-motion.md Round 12 "Board selection": picked board cards show no bar;
 * ⌘/ opens an action menu, and Escape closes it before it clears the pick.
 */

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
        { id: 'made', name: 'Created', type: 'createdTime', position: 'a3' },
      ],
      views: [{ id: 'v', name: 'View', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['s', 'notes', 'made'], ...view }],
      activeViewId: 'v',
    },
    content: ['r1', 'r2', 'r3'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'Alpha', s: 'o1' }, position: 'a0' } },
  { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Bravo', s: 'o1' }, position: 'a1' } },
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

const key = async (init: KeyboardEventInit, target: EventTarget = document.activeElement ?? document.body): Promise<void> => {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  await quiet();
};

const savedRows = async (): Promise<OutputBlockData[]> =>
  (await editor?.save())?.blocks.filter((block) => block.type === 'database-row') ?? [];

const VIEWS = [
  ['board', { type: 'board', groupBy: 's' }, '[data-blok-database-card]'],
  ['gallery', { type: 'gallery' }, '[data-blok-database-gallery-card]'],
] as const;

const pick = async (rowSelector: string, ...rowIds: string[]): Promise<void> => {
  for (const rowId of rowIds) {
    await click(q(`${rowSelector}[data-row-id="${rowId}"]`), { metaKey: true });
  }
};

const selectedIds = (): string[] =>
  [...(holder?.querySelectorAll('[data-blok-database-row-selected]') ?? [])].map((el) => el.getAttribute('data-row-id') ?? '');

const openMenu = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-popover-opened]');

const outline = (): string[] =>
  [...(openMenu()?.querySelectorAll('[data-blok-testid="popover-item-title"], [data-blok-testid="popover-item-separator"], [data-blok-database-row-menu-heading]') ?? [])]
    .map((node) => {
      if (node.hasAttribute('data-blok-database-row-menu-heading')) return `heading:${node.textContent ?? ''}`;
      if (node.getAttribute('data-blok-testid') === 'popover-item-separator') return '|';

      return node.textContent ?? '';
    });

const item = (title: string): HTMLElement | null =>
  [...document.querySelectorAll<HTMLElement>('[data-blok-popover-opened] [data-blok-testid="popover-item-title"]')]
    .find((node) => node.textContent === title)?.closest<HTMLElement>('[data-blok-popover-item]') ?? null;

describe('board and gallery selection: ⌘/ action menu (notion-motion.md Round 12)', () => {
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

  it.each(VIEWS)('%s: picked cards show no selection bar', async (_name, view, rowSelector) => {
    await make(doc(view));
    await pick(rowSelector, 'r1', 'r2');

    expect(selectedIds()).toEqual(['r1', 'r2']);
    expect(q('[data-blok-database-table-selection-bar]')).toBeNull();
    expect(document.body.textContent).not.toContain('2 selected');
  });

  it.each(VIEWS.flatMap(([name, view, sel]) => (['metaKey', 'ctrlKey'] as const).map((mod) => [`${name}, ${mod}`, view, sel, mod] as const)))(
    '%s+/ opens the action menu with its search focused', async (_name, view, rowSelector, mod) => {
      await make(doc(view));
      await pick(rowSelector, 'r1', 'r2');
      await key({ key: '/', [mod]: true });

      expect(outline()).toEqual(['heading:Page', 'Edit property', '|', 'Duplicate', 'Move to Trash']);
      const search = document.activeElement;

      expect(search instanceof HTMLInputElement && openMenu()?.contains(search)).toBe(true);
      expect((search as HTMLInputElement).placeholder).toBe('Search actions…');
      expect(item('Duplicate')?.querySelector('[data-blok-testid="popover-item-secondary-title"]')).not.toBeNull();
      expect(item('Move to Trash')?.querySelector('[data-blok-testid="popover-item-secondary-title"]')).toBeNull();
      // The menu marks no card: the card's own ⋯ stays hidden.
      expect(q(`${rowSelector}[data-popover-open]`)).toBeNull();
    },
  );

  it.each(VIEWS)('%s: Escape in the search closes the menu and keeps the pick; a second Escape clears it', async (_name, view, rowSelector) => {
    await make(doc(view));
    await pick(rowSelector, 'r1', 'r2');
    await key({ key: '/', metaKey: true });
    await key({ key: 'Escape' });

    expect(openMenu()).toBeNull();
    expect(selectedIds()).toEqual(['r1', 'r2']);

    await key({ key: 'Escape' }, document.body);

    expect(selectedIds()).toEqual([]);
  });

  it.each(VIEWS)('%s: Escape with focus off the search still closes only the menu', async (_name, view, rowSelector) => {
    await make(doc(view));
    await pick(rowSelector, 'r1', 'r2');
    await key({ key: '/', metaKey: true });
    (document.activeElement as HTMLElement | null)?.blur();
    await key({ key: 'Escape' }, document.body);

    expect(openMenu()).toBeNull();
    expect(selectedIds()).toEqual(['r1', 'r2']);
  });

  it.each(VIEWS)('%s: Edit property lists the bulk-editable properties, and a pick writes every card', async (_name, view, rowSelector) => {
    await make(doc(view));
    await pick(rowSelector, 'r1', 'r2');
    await key({ key: '/', metaKey: true });
    await click(item('Edit property'));

    expect(document.querySelector('[data-blok-item-name="database-bulk-edit-made"]')).toBeNull();
    expect(document.querySelector('[data-blok-item-name="database-bulk-edit-t"]')).toBeNull();
    await click(document.querySelector('[data-blok-item-name="database-bulk-edit-notes"]'));
    const field = document.querySelector<HTMLTextAreaElement>('[data-blok-database-cell-input]');

    if (field === null) throw new Error('no text field');
    field.value = 'both';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await quiet();

    expect((await savedRows()).map((row) => (row.data as { properties: Record<string, unknown> }).properties.notes)).toEqual(['both', 'both', undefined]);
  });

  it.each(VIEWS)('%s: Duplicate and Move to Trash act on every picked card', async (_name, view, rowSelector) => {
    await make(doc(view));
    await pick(rowSelector, 'r1', 'r2');
    await key({ key: '/', metaKey: true });
    await click(item('Duplicate'));

    expect(await savedRows()).toHaveLength(5);

    await key({ key: 'Escape' }, document.body);
    await pick(rowSelector, 'r3');
    await key({ key: '/', metaKey: true });
    await click(item('Move to Trash'));

    expect((await savedRows()).map((row) => row.id)).not.toContain('r3');
    expect(await savedRows()).toHaveLength(4);
  });

  it.each([
    ['table', {}, ''],
    ['list', { type: 'list' }, '[data-blok-database-list-row]'],
  ] as const)('%s keeps its "N selected" bar', async (_name, view, rowSelector) => {
    await make(doc(view));
    if (rowSelector === '') {
      await click(q('[data-row-id="r1"] [data-blok-database-table-row-checkbox]'));
    } else {
      await pick(rowSelector, 'r1');
    }

    expect(q('[data-blok-database-table-selection-bar]')).not.toBeNull();
  });
});
