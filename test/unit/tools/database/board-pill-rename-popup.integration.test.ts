import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { OutputBlockData, OutputData } from '../../../../types';

/**
 * notion-motion.md Round 98 §1 #1 (r98-n-pill-space-dump.raw): Enter or Space on a focused
 * column pill opens a rename popup under it, with the name selected and a "Done ↵" button.
 * Escape and Done give focus back to the pill.
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

const pill = (): HTMLElement | null => q('[data-blok-database-column-pill]');
const field = (): HTMLInputElement | null => document.querySelector<HTMLInputElement>('[data-blok-database-group-name-field] input');
const done = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('[data-blok-database-group-name-field] [data-blok-database-new-group-done]');

const type = async (value: string): Promise<void> => {
  const input = field();

  if (input === null) throw new Error('no field');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await quiet();
};

const openRename = async (name: string): Promise<void> => {
  pill()?.focus();
  await key(pill() ?? document.body, name);
};

describe('board: column pill rename popup', () => {
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

  it.each(['Enter', ' '])('%j opens the popup with the whole name selected, not an inline field', async (name) => {
    await openRename(name);

    expect(field()).toHaveFocus();
    expect(field()?.value).toBe('Todo');
    expect([field()?.selectionStart, field()?.selectionEnd]).toEqual([0, 4]);
    expect(done()?.textContent).toContain('Done');
    expect(field()?.closest('[data-blok-popover-custom-class~="blok-database-menu"]')).not.toBeNull();
    expect(q('[data-blok-database-column-title-input]')).toBeNull();
  });

  // notion-motion.md Round 99 §1 #1: a click opens the same popup as Enter.
  it('a click opens the popup too, and Done renames the group', async () => {
    pill()?.click();
    await quiet();

    expect(field()).toHaveFocus();
    expect(field()?.value).toBe('Todo');
    expect(q('[data-blok-database-column] input')).toBeNull();

    await type('Review');
    done()?.click();
    await quiet();

    expect(await labels()).toEqual(['Review']);
    await vi.waitFor(() => expect(pill()).toHaveFocus());
  });

  it('Enter in the field renames the group, and the pill takes focus back', async () => {
    await openRename('Enter');
    await type('Review');
    await key(field() ?? document.body, 'Enter');

    expect(await labels()).toEqual(['Review']);
    await vi.waitFor(() => expect(field()).toBeNull());
    expect(pill()?.textContent).toBe('Review');
    expect(pill()).toHaveFocus();
  });

  it('Done renames the group too', async () => {
    await openRename(' ');
    await type('Review');
    done()?.click();
    await quiet();

    expect(await labels()).toEqual(['Review']);
    await vi.waitFor(() => expect(pill()).toHaveFocus());
  });

  it('Escape keeps the name, and the pill takes focus back', async () => {
    await openRename('Enter');
    await type('Review');
    await key(field() ?? document.body, 'Escape');

    await vi.waitFor(() => expect(field()).toBeNull());
    expect(await labels()).toEqual(['Todo']);
    expect(pill()?.textContent).toBe('Todo');
    expect(pill()).toHaveFocus();
  });
});
