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

const doc = (viewOverrides: Record<string, unknown> = {}): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
      views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...viewOverrides }],
      activeViewId: 'v',
    },
    content: ['r1', 'r2', 'r3'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One' }, position: 'a0' } },
  { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Two' }, position: 'a1' } },
  { id: 'r3', type: 'database-row', parent: 'db', data: { properties: { t: 'Three' }, position: 'a2' } },
];

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (blocks: OutputBlockData[], config: Record<string, unknown> = {}): Promise<void> => {
  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      database: { class: DatabaseTool, config },
      'database-row': DatabaseRowTool,
    },
    data: { blocks },
  } as never) as unknown as TestEditor;
  await editor.isReady;
  await quiet();
};

const q = <T extends Element = HTMLElement>(selector: string): T | null => holder?.querySelector<T>(selector) ?? null;

const click = async (el: Element | null): Promise<void> => {
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await quiet();
};

const openRow = (rowId: string): Promise<void> =>
  click(q(`[data-row-id="${rowId}"] [data-blok-database-table-open]`));

const drawer = (): HTMLElement | null => q('[data-blok-database-drawer]');

const shownTitle = (): string | undefined => q<HTMLTextAreaElement>('[data-blok-database-drawer-title]')?.value;

const key = async (init: KeyboardEventInit): Promise<void> => {
  document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  await quiet();
};

const savedView = async (): Promise<Record<string, unknown> | undefined> => {
  const saved = await editor?.save();
  const data = saved?.blocks.find((block) => block.id === 'db')?.data as { views: Array<Record<string, unknown>> } | undefined;

  return data?.views[0];
};

describe('row page peek modes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    document.querySelectorAll('[data-blok-popover]').forEach((el) => el.remove());
    vi.restoreAllMocks();
  });

  it('opens a table row in a side peek by default', async () => {
    await make(doc());
    await openRow('r1');

    expect(drawer()?.getAttribute('data-peek-mode')).toBe('side');
    expect(drawer()?.getAttribute('role')).toBe('complementary');
  });

  it('opens a center peek as a modal over a backdrop, and Escape closes it', async () => {
    await make(doc({ openPagesIn: 'center' }));
    await openRow('r1');

    expect(drawer()?.getAttribute('data-peek-mode')).toBe('center');
    expect(drawer()?.getAttribute('role')).toBe('dialog');
    expect(drawer()?.getAttribute('aria-modal')).toBe('true');
    expect(q('[data-blok-database-peek-backdrop]')).not.toBeNull();

    await key({ key: 'Escape' });

    expect(q('[data-blok-database-drawer][data-open]')).toBeNull();
    expect(q('[data-blok-database-peek-backdrop]')).toBeNull();
  });

  it('shows a full page in place of the database, with a back button, when the host has no navigate lever', async () => {
    await make(doc({ openPagesIn: 'full' }));
    await openRow('r2');

    expect(drawer()?.getAttribute('data-peek-mode')).toBe('full');
    expect(q('[data-blok-database-wrapper]')?.hasAttribute('data-blok-database-full-page')).toBe(true);
    expect(shownTitle()).toBe('Two');

    await click(q('[data-blok-database-drawer-close]'));

    expect(q('[data-blok-database-wrapper]')?.hasAttribute('data-blok-database-full-page')).toBe(false);
  });

  it('hands a full page to the host navigate lever instead of drawing it', async () => {
    const navigate = vi.fn();

    await make(doc({ openPagesIn: 'full' }), {
      rowPages: {
        lookup: vi.fn().mockResolvedValue(null),
        copyFromLegacy: vi.fn(),
        reconcileLegacy: vi.fn(),
        mount: vi.fn(() => ({ destroy: vi.fn() })),
        navigate,
      },
    });
    await openRow('r2');

    expect(navigate).toHaveBeenCalledWith('r2');
    expect(drawer()).toBeNull();
  });

  it('steps to the next and previous row with the header arrows', async () => {
    await make(doc());
    await openRow('r1');
    await click(q('[data-blok-database-peek-next]'));

    expect(shownTitle()).toBe('Two');

    await click(q('[data-blok-database-peek-next]'));

    expect(shownTitle()).toBe('Three');
    expect(q<HTMLButtonElement>('[data-blok-database-peek-next]')?.disabled).toBe(true);

    await click(q('[data-blok-database-peek-prev]'));

    expect(shownTitle()).toBe('Two');
  });

  it('steps rows with Ctrl+J and Ctrl+K off a Mac', async () => {
    await make(doc());
    await openRow('r2');
    await key({ key: 'j', code: 'KeyJ', ctrlKey: true });

    expect(shownTitle()).toBe('Three');

    await key({ key: 'k', code: 'KeyK', ctrlKey: true });
    await key({ key: 'k', code: 'KeyK', ctrlKey: true });

    expect(shownTitle()).toBe('One');
  });

  it('leaves Ctrl+K to the text when the caret is in an editable field', async () => {
    await make(doc());
    await openRow('r2');
    const title = q<HTMLTextAreaElement>('[data-blok-database-drawer-title]');

    title?.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }));
    await quiet();

    expect(shownTitle()).toBe('Two');
  });

  it('expands a peek to a full page with the expand button', async () => {
    await make(doc());
    await openRow('r1');
    await click(q('[data-blok-database-peek-expand]'));

    expect(drawer()?.getAttribute('data-peek-mode')).toBe('full');
    expect(q('[data-blok-database-wrapper]')?.hasAttribute('data-blok-database-full-page')).toBe(true);
  });

  it('opens a new row of a filtered view in its peek, prefilled so it passes the filter', async () => {
    const blocks = doc({ filters: [{ propertyId: 'n', operator: 'equals', value: 'Draft' }] });

    (blocks[0].data as { schema: unknown[] }).schema.push({ id: 'n', name: 'Notes', type: 'text', position: 'a1' });
    await make(blocks);
    await click(q('[data-blok-database-table-add-row]'));

    const rowId = drawer()?.closest('[data-blok-database-wrapper]') === null ? undefined : (await editor?.save())?.blocks
      .filter((block) => block.type === 'database-row').at(-1)?.id;

    expect(drawer()?.getAttribute('data-peek-mode')).toBe('side');
    expect(rowId).toBeDefined();
    expect(drawer()?.querySelector(`[data-blok-element][data-blok-id="${rowId}"]`)).not.toBeNull();

    const saved = (await editor?.save())?.blocks.find((block) => block.id === rowId);

    expect((saved?.data as { properties: Record<string, unknown> }).properties.n).toBe('Draft');
  });

  it('Escape deletes a new row left empty in its peek, and keeps one that got a title', async () => {
    const blocks = doc({ filters: [{ propertyId: 'n', operator: 'is_not_empty', value: null }] });

    (blocks[0].data as { schema: unknown[] }).schema.push({ id: 'n', name: 'Notes', type: 'text', position: 'a1' });
    await make(blocks);
    const rowCount = async (): Promise<number> => ((await editor?.save())?.blocks ?? []).filter((block) => block.type === 'database-row').length;

    await click(q('[data-blok-database-table-add-row]'));
    expect(await rowCount()).toBe(4);
    await key({ key: 'Escape' });

    expect(await rowCount()).toBe(3);

    await click(q('[data-blok-database-table-add-row]'));
    const title = q<HTMLTextAreaElement>('[data-blok-database-drawer-title]');

    if (title !== null) {
      title.value = 'Kept';
      title.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await key({ key: 'Escape' });

    expect(await rowCount()).toBe(4);
  });

  it('Escape on a board deletes the card + New just made while it is still empty', async () => {
    const blocks = doc();

    blocks[0].data = {
      ...blocks[0].data,
      schema: [
        { id: 't', name: 'Name', type: 'title', position: 'a0' },
        { id: 's', name: 'Status', type: 'select', position: 'a1', config: { options: [{ id: 'o1', label: 'Todo', position: 'a0' }] } },
      ],
      views: [{ id: 'v', name: 'Board', type: 'board', groupBy: 's', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
    };
    await make(blocks);
    const rowCount = async (): Promise<number> => ((await editor?.save())?.blocks ?? []).filter((block) => block.type === 'database-row').length;

    await click(q('[data-blok-database-add-card][data-option-id="o1"]'));
    expect(await rowCount()).toBe(4);
    q('[data-blok-database-board]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await quiet();

    expect(await rowCount()).toBe(3);
  });

  it('the row menu "Edit icon" opens the row page with the icon picker', async () => {
    await make(doc());
    await click(q('[data-row-id="r2"] [data-blok-database-table-row-handle]'));
    const editIcon = [...document.querySelectorAll<HTMLElement>('[data-blok-popover-item]')]
      .find((item) => item.textContent?.includes('Edit icon'));

    await click(editIcon ?? null);

    expect(shownTitle()).toBe('Two');
    expect(document.querySelector('[data-blok-emoji-picker]')?.isConnected).toBe(true);
  });

  it('"+ Add a property" on the page goes through the database add-property menu, which a lock closes', async () => {
    const blocks = doc();

    (blocks[0].data as { schema: Array<Record<string, unknown>> }).schema[0].databaseLocked = true;
    await make(blocks);
    await openRow('r1');
    await click(q('[data-blok-database-drawer-add-prop]'));

    expect(document.querySelector('[data-blok-database-property-type-popover]')).toBeNull();
  });

  it('switches the mode from the peek header and saves it on the view', async () => {
    await make(doc());
    await openRow('r1');
    await click(q('[data-blok-database-peek-mode]'));

    const center = [...document.querySelectorAll<HTMLElement>('[data-blok-popover-item]')]
      .find((item) => item.textContent?.includes('Center peek'));

    await click(center ?? null);

    expect(drawer()?.getAttribute('data-peek-mode')).toBe('center');
    expect((await savedView())?.openPagesIn).toBe('center');
  });
});
