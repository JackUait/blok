import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { OutputBlockData, OutputData } from '../../../../types';

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

const SCHEMA = [
  { id: 't', name: 'Name', type: 'title', position: 'a0' },
  {
    id: 'st', name: 'Stage', type: 'status', position: 'a1',
    config: { options: [{ id: 's-todo', label: 'Not started', color: 'gray', position: 'a0', groupId: 'todo' }] },
  },
  { id: 'due', name: 'Due', type: 'date', position: 'a2' },
  { id: 'done', name: 'Done', type: 'checkbox', position: 'a3' },
  { id: 'fx', name: 'Twice', type: 'formula', position: 'a4', formula: { expression: '1 + 1' } },
];

const doc = (rowCount = 2, viewOverrides: Record<string, unknown> = {}): OutputBlockData[] => {
  const ids = Array.from({ length: rowCount }, (_, i) => `r${i + 1}`);

  return [
    {
      id: 'db',
      type: 'database',
      data: {
        schema: SCHEMA,
        views: [{
          id: 'v', name: 'List', type: 'list', position: 'a0', sorts: [], filters: [],
          visibleProperties: ['st', 'due', 'done', 'fx'],
          ...viewOverrides,
        }],
        activeViewId: 'v',
      },
      content: ids,
    },
    ...ids.map((id, i): OutputBlockData => ({
      id,
      type: 'database-row',
      parent: 'db',
      data: { properties: { t: `Row ${i + 1}`, st: 's-todo', due: '2026-10-12', done: false }, position: `a${String.fromCharCode(48 + i)}` },
    })),
  ];
};

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (blocks: OutputBlockData[]): Promise<void> => {
  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      database: { class: DatabaseTool, config: {} },
      'database-row': DatabaseRowTool,
    },
    data: { blocks },
  } as never) as unknown as TestEditor;
  await editor.isReady;
  await quiet();
};

const q = <T extends Element = HTMLElement>(selector: string): T | null => holder?.querySelector<T>(selector) ?? null;
const slot = (rowId: string, propertyId: string): HTMLElement | null =>
  q(`[data-blok-database-list-row][data-row-id="${rowId}"] [data-blok-database-list-row-property][data-property-id="${propertyId}"]`);
const savedRows = async (): Promise<OutputBlockData[]> =>
  ((await editor?.save())?.blocks ?? []).filter((block) => block.type === 'database-row');
const propsOf = (block: OutputBlockData | undefined): Record<string, unknown> =>
  (block?.data as { properties: Record<string, unknown> } | undefined)?.properties ?? {};

describe('Database list view (tool)', () => {
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

  it('shows formatted values, never a status id or an ISO date', async () => {
    await make(doc());

    expect(slot('r1', 'st')?.textContent).toBe('Not started');
    expect(slot('r1', 'due')?.textContent).not.toBe('2026-10-12');
    expect(slot('r1', 'fx')?.textContent).toBe('2');
  });

  it('never offers to edit a computed property', async () => {
    await make(doc());

    expect(slot('r1', 'fx')?.hasAttribute('data-editable')).toBe(false);
    expect(slot('r1', 'st')?.hasAttribute('data-editable')).toBe(true);
  });

  it('edits a property in place on click, without opening the page', async () => {
    await make(doc());
    slot('r1', 'st')?.click();
    await quiet();

    expect(document.querySelector('[data-blok-database-select-editor]')).not.toBeNull();
    expect(q('[data-blok-database-drawer]')?.hasAttribute('data-open') ?? false).toBe(false);
  });

  it('commits an in-place edit and gives focus back to the same property after the redraw', async () => {
    await make(doc());
    slot('r1', 'done')?.focus();
    slot('r1', 'done')?.click();
    await quiet();

    expect(propsOf((await savedRows()).find((block) => block.id === 'r1')).done).toBe(true);
    expect(slot('r1', 'done')).toHaveFocus();
  });

  it('Shift+Enter adds an item right below the row and starts its title edit', async () => {
    await make(doc(3));
    q('[data-blok-database-list-row][data-row-id="r1"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
    await quiet();

    const rows = [...(holder?.querySelectorAll('[data-blok-database-list-row]') ?? [])].map((el) => el.getAttribute('data-row-id'));
    const newId = rows[1];

    expect(rows).toHaveLength(4);
    expect(newId).not.toBe('r2');

    const input = q<HTMLInputElement>(`[data-row-id="${newId}"] [data-blok-database-list-title-input]`);

    expect(input).not.toBeNull();
    if (input === null) return;
    input.value = 'Inserted';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await quiet();

    expect(propsOf((await savedRows()).find((block) => block.id === newId)).t).toBe('Inserted');
  });

  it('"+ New page" adds the row inside the role="list" rows, not after the button', async () => {
    await make(doc());
    q('[data-blok-database-add-row]')?.click();
    await quiet();

    const rows = q('[data-blok-database-list] > [role="list"]');

    expect(rows?.querySelectorAll('[data-blok-database-list-row]')).toHaveLength(3);
    expect(holder?.querySelectorAll('[data-blok-database-list-row]')).toHaveLength(3);
  });

  // findings-listgallery L05: the new row opens with its title being edited.
  it('"+ New page" opens the new row\'s title for typing; Enter saves it', async () => {
    await make(doc());
    q('[data-blok-database-add-row]')?.click();
    await quiet();

    const rows = [...(holder?.querySelectorAll('[data-blok-database-list-row]') ?? [])];
    const newId = rows.at(-1)?.getAttribute('data-row-id') ?? '';
    const input = q<HTMLInputElement>(`[data-row-id="${newId}"] [data-blok-database-list-title-input]`);

    expect(input).not.toBeNull();
    expect(input).toHaveFocus();
    if (input === null) return;
    input.value = 'Fresh';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await quiet();

    expect(propsOf((await savedRows()).find((block) => block.id === newId)).t).toBe('Fresh');
  });

  it('shows the load limit, then the rest after "Load more"', async () => {
    await make(doc(12, { loadLimit: 10 }));

    expect(holder?.querySelectorAll('[data-blok-database-list-row]')).toHaveLength(10);
    q('[data-blok-database-list-load-more]')?.click();
    await quiet();

    expect(holder?.querySelectorAll('[data-blok-database-list-row]')).toHaveLength(12);
    expect(q('[data-blok-database-list-load-more]')).toBeNull();
  });
});
