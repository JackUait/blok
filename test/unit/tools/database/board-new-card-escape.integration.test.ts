import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { OutputBlockData, OutputData } from '../../../../types';

/** notion-motion.md, Round 9: Escape on an empty new board card selects it, with no "1 selected" bar. */

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

const rowIds = async (): Promise<string[]> =>
  ((await editor?.save())?.blocks ?? []).filter((block) => block.type === 'database-row').map((block) => block.id ?? '');

describe('board: Escape on an empty new card', () => {
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

  it('keeps the card selected with no selection bar, and Delete trashes it', async () => {
    q('[data-blok-database-add-card][data-option-id="o1"]')?.click();
    await quiet();
    const input = q<HTMLInputElement>('[data-blok-database-card-title-input]');

    if (input === null) throw new Error('no title input');
    const newId = input.closest('[data-row-id]')?.getAttribute('data-row-id') ?? '';

    await key(input, 'Escape');

    expect(q('[data-blok-database-table-selection-bar]')).toBeNull();
    expect(q('[data-blok-database-selecting]')).toBeNull();
    expect(q(`[data-blok-database-card][data-row-id="${newId}"]`)?.hasAttribute('data-blok-database-row-selected')).toBe(true);

    await key(document.body, 'Delete');

    expect(await rowIds()).toEqual(['r1']);
  });

  it('a later pick of another card shows the bar as before', async () => {
    q('[data-blok-database-add-card][data-option-id="o1"]')?.click();
    await quiet();
    const input = q<HTMLInputElement>('[data-blok-database-card-title-input]');

    if (input === null) throw new Error('no title input');
    await key(input, 'Escape');
    q('[data-blok-database-card][data-row-id="r1"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    await quiet();

    expect(q('[data-blok-database-table-selection-bar]')).not.toBeNull();
  });
});
