import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { OutputBlockData, OutputData } from '../../../../types';

/**
 * research/08:125, :139 and shots-08/61-board-new-group.png: "+ New group" opens a name
 * popover ("New group" field, "Done ↵") with the menu motion; the column comes on Done.
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

const blocks: OutputBlockData[] = [
  {
    id: 'db',
    type: 'database',
    data: {
      schema: [
        { id: 't', name: 'Name', type: 'title', position: 'a0' },
        { id: 's', name: 'Status', type: 'select', position: 'a1', config: { options: [{ id: 'o1', label: 'Todo', position: 'a0' }] } },
      ],
      views: [{ id: 'v', name: 'Board', type: 'board', groupBy: 's', position: 'a0', sorts: [], filters: [], visibleProperties: ['s'] }],
      activeViewId: 'v',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'Alpha', s: 'o1' }, position: 'a0' } },
];

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const q = <T extends Element = HTMLElement>(selector: string): T | null => holder?.querySelector<T>(selector) ?? null;

const key = async (target: EventTarget, name: string): Promise<void> => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  await quiet();
};

const labels = async (): Promise<string[]> => {
  const db = ((await editor?.save())?.blocks ?? []).find((block) => block.id === 'db');
  const schema = (db?.data as { schema: Array<{ id: string; config?: { options: Array<{ label: string }> } }> }).schema;

  return (schema.find((p) => p.id === 's')?.config?.options ?? []).map((option) => option.label);
};

const field = (): HTMLInputElement | null => document.querySelector<HTMLInputElement>('[data-blok-database-new-group] input');
const done = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('[data-blok-database-new-group] [data-blok-database-new-group-done]');
const columns = (): number => holder?.querySelectorAll('[data-blok-database-column]').length ?? 0;

const openNewGroup = async (): Promise<void> => {
  q('[data-blok-database-add-column]')?.click();
  await quiet();
};

const type = async (value: string): Promise<void> => {
  const input = field();

  if (input === null) throw new Error('no field');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await quiet();
};

describe('board: "+ New group" name popover', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
    editor = new Blok({
      holder,
      dataModel: 'hierarchical',
      tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
      data: { blocks },
    } as never) as unknown as TestEditor;
    await editor.isReady;
    await quiet();
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('opens a database menu with a focused "New group" field and "Done", and adds no column yet', async () => {
    const before = columns();

    await openNewGroup();

    expect(field()?.placeholder).toBe('New group');
    expect(field()).toHaveFocus();
    expect(done()?.textContent).toContain('Done');
    expect(field()?.closest('[data-blok-popover-custom-class~="blok-database-menu"]')).not.toBeNull();
    expect(columns()).toBe(before);
    expect(await labels()).toEqual(['Todo']);
  });

  it('Enter adds a column with the typed name and closes the popover', async () => {
    const before = columns();

    await openNewGroup();
    await type('Review');
    await key(field() ?? document.body, 'Enter');

    expect(await labels()).toEqual(['Todo', 'Review']);
    expect(columns()).toBe(before + 1);
    expect(holder?.textContent).toContain('Review');
    await vi.waitFor(() => expect(field()).toBeNull());
  });

  it('Done adds the column too', async () => {
    await openNewGroup();
    await type('  Review  ');
    done()?.click();
    await quiet();

    expect(await labels()).toEqual(['Todo', 'Review']);
  });

  it('adds nothing on Done with an empty name, or on Escape', async () => {
    await openNewGroup();
    done()?.click();
    await quiet();
    expect(await labels()).toEqual(['Todo']);

    await openNewGroup();
    await type('Review');
    await key(field() ?? document.body, 'Escape');
    expect(await labels()).toEqual(['Todo']);
    await vi.waitFor(() => expect(field()).toBeNull());
  });
});
