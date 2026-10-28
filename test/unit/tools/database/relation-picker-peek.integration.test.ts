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

// notion-spec-2 §19.2 (02-rel-enter-linked.png, 02-after-peek-esc.png).
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
    expect(search()).toHaveFocus();
    expect(document.querySelector('[data-blok-database-relation-option="r2"]')?.getAttribute('aria-selected')).toBe('true');
  });
});
