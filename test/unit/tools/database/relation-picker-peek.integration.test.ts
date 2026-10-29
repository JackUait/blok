import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { PropertyDefinition } from '../../../../src/tools/database/types';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy(): void;
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const quiet = async (): Promise<void> => {
  for (const _ of [0, 1, 2]) await new Promise((resolve) => setTimeout(resolve, 0));
};

const press = (target: EventTarget, key: string): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
};

const search = (): HTMLInputElement | null => document.querySelector<HTMLInputElement>('[data-blok-database-relation-search]');
const peek = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-database-drawer]');

// notion-spec-2 §19.2 (02-rel-enter-linked.png, 02-after-peek-esc.png), §20.12.
describe('table relation picker over a linked page', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
    const schema: PropertyDefinition[] = [
      { id: 't', name: 'Name', type: 'title', position: 'a0' },
      { id: 'rel', name: 'Related', type: 'relation', position: 'a1', relation: { targetDatabaseId: 'db' } },
    ];

    editor = new Blok({
      holder,
      dataModel: 'hierarchical',
      tools: { database: DatabaseTool, 'database-row': DatabaseRowTool },
      data: { blocks: [
        { id: 'db', type: 'database', content: ['r1', 'r2'], data: {
          schema,
          views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [],
            properties: schema.map((p) => ({ id: p.id, visible: true })) }],
          activeViewId: 'v',
        } },
        { id: 'r1', type: 'database-row', parent: 'db', data: { position: 'a0', properties: { t: 'One', rel: [{ id: 'r2' }] } } },
        { id: 'r2', type: 'database-row', parent: 'db', data: { position: 'a1', properties: { t: 'Two' } } },
      ] },
    });
    await editor.isReady;
    await quiet();
  });

  afterEach(() => {
    editor?.destroy();
    holder?.remove();
    vi.restoreAllMocks();
  });

  it('opens the page in a centred peek, keeps the picker under it, and Escape returns to the picker', async () => {
    const cell = holder?.querySelector<HTMLElement>('[data-row-id="r1"] [role="gridcell"][data-property-id="rel"]');

    if (cell === null || cell === undefined) throw new Error('missing relation cell');
    cell.click();
    await quiet();
    const field = search();

    if (field === null) throw new Error('picker did not open');
    press(field, 'Enter');
    await quiet();

    expect(peek()?.getAttribute('data-peek-mode')).toBe('center');
    expect(search()?.isConnected).toBe(true);

    press(document.activeElement ?? document.body, 'Escape');
    await quiet();

    expect(peek()).toBeNull();
    expect(search()?.isConnected).toBe(true);
    // notion-spec-2 §20.12: focus goes to the page body, not the search.
    expect(search()).not.toHaveFocus();
    expect(document.querySelector('[data-blok-database-relation-option="r2"]')?.getAttribute('aria-selected')).toBe('true');
  });
});

// notion-spec-2 §21.2 (E6-rel-nomatch.png): "+ New <query> in <database>" makes the page and links it, both ways.
describe('table relation picker creating a page', () => {
  let blok: (TestEditor & { save(): Promise<{ blocks: Array<{ id?: string; type: string; data: Record<string, unknown> }> }> }) | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
    const schema: PropertyDefinition[] = [
      { id: 't', name: 'Name', type: 'title', position: 'a0' },
      { id: 'rel', name: 'Related', type: 'relation', position: 'a1', relation: { targetDatabaseId: 'db', twoWay: true, syncedPropertyId: 'back' } },
      { id: 'back', name: 'Back', type: 'relation', position: 'a2', relation: { targetDatabaseId: 'db', twoWay: true, syncedPropertyId: 'rel' } },
    ];

    blok = new Blok({
      holder,
      dataModel: 'hierarchical',
      tools: { database: DatabaseTool, 'database-row': DatabaseRowTool },
      data: { blocks: [
        { id: 'db', type: 'database', content: ['r1'], data: {
          title: 'Tasks',
          schema,
          views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [],
            properties: schema.map((p) => ({ id: p.id, visible: true })) }],
          activeViewId: 'v',
        } },
        { id: 'r1', type: 'database-row', parent: 'db', data: { position: 'a0', properties: { t: 'One' } } },
      ] },
    }) as unknown as typeof blok;
    await blok?.isReady;
    await quiet();
  });

  afterEach(() => {
    blok?.destroy();
    holder?.remove();
    vi.restoreAllMocks();
  });

  it('makes a page titled as typed, links it, and writes the other side', async () => {
    const cell = holder?.querySelector<HTMLElement>('[data-row-id="r1"] [role="gridcell"][data-property-id="rel"]');

    if (cell === null || cell === undefined) throw new Error('missing relation cell');
    cell.click();
    await quiet();
    const field = search();

    if (field === null) throw new Error('picker did not open');
    expect(field.placeholder).toBe('Link or create a page…');
    field.value = 'Zeta';
    field.dispatchEvent(new Event('input'));
    expect(document.querySelector('[data-blok-database-relation-create]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('New Zeta in Tasks');
    press(field, 'Enter');
    await quiet();

    const saved = await blok?.save();
    const rows = (saved?.blocks ?? []).filter((block) => block.type === 'database-row');
    const made = rows.find((row) => (row.data.properties as Record<string, unknown>).t === 'Zeta');
    const one = rows.find((row) => row.id === 'r1');

    if (made === undefined) throw new Error('no new page');
    expect((one?.data.properties as Record<string, unknown>).rel).toEqual([{ id: made.id }]);
    expect((made.data.properties as Record<string, unknown>).back).toEqual([{ id: 'r1' }]);
    expect(search()?.isConnected).toBe(true);
  });
});
