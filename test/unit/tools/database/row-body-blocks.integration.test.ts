import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { API, OutputBlockData, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  history: { undo: () => void; redo: () => void };
}

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

const quiet = async (): Promise<void> => {
  await settle();
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
  await settle();
};

const databaseBlock = (overrides: Record<string, unknown> = {}): OutputBlockData => ({
  id: 'db',
  type: 'database',
  data: {
    schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }],
    views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
    activeViewId: 'v',
    ...overrides,
  },
  content: ['r1', 'r2'],
});

const docWithBodies = (): OutputBlockData[] => [
  { id: 'p0', type: 'paragraph', data: { text: 'before' } },
  databaseBlock(),
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One' }, position: 'a0' }, content: ['c1'] },
  { id: 'c1', type: 'paragraph', parent: 'r1', data: { text: 'first body' } },
  { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Two' }, position: 'a1' } },
  { id: 'p2', type: 'paragraph', data: { text: 'after' } },
];

// The cover picker positions itself with elementFromPoint, which jsdom lacks.
if (typeof document.elementFromPoint !== 'function') {
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (blocks: OutputBlockData[], readOnly = false, databaseClass = DatabaseTool): Promise<TestEditor> => {
  editor = new Blok({
    holder,
    readOnly,
    dataModel: 'hierarchical',
    tools: { paragraph: Paragraph, database: databaseClass, 'database-row': DatabaseRowTool },
    data: { blocks },
  } as never) as unknown as TestEditor;
  await editor.isReady;
  await quiet();

  return editor;
};

const holderOf = (id: string): HTMLElement | null =>
  holder?.querySelector<HTMLElement>(`[data-blok-element][data-blok-id="${id}"]`) ?? null;

const databaseHolder = (): HTMLElement | null => holderOf('db');

const drawerBody = (): HTMLElement | null =>
  holder?.querySelector<HTMLElement>('[data-blok-database-drawer-editor]') ?? null;

const openRow = async (rowId: string): Promise<void> => {
  const button = holder?.querySelector<HTMLElement>(`[data-row-id="${rowId}"] [data-blok-database-table-open]`)
    ?? holder?.querySelector<HTMLElement>(`[data-blok-database-table-open][data-row-id="${rowId}"]`);

  button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await quiet();
};

const pressEscape = async (): Promise<void> => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await quiet();
};

const legacyDoc = (): OutputBlockData[] => [
  {
    ...databaseBlock(),
    data: {
      ...databaseBlock().data,
      schema: [
        { id: 't', name: 'Name', type: 'title', position: 'a0' },
        { id: 'd', name: 'Card details', type: 'richText', position: 'a1' },
      ],
    },
    content: ['r1'],
  },
  {
    id: 'r1',
    type: 'database-row',
    parent: 'db',
    data: {
      properties: {
        t: 'Old',
        d: { blocks: [{ id: 'x', type: 'paragraph', data: { text: 'legacy one' } }, { id: 'y', type: 'paragraph', data: { text: 'legacy two' } }] },
      },
      position: 'a0',
    },
  },
];

describe('row bodies are child blocks of the row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    vi.restoreAllMocks();
  });

  it('keeps row holders and their body blocks inside the database, hidden until opened', async () => {
    await make(docWithBodies());

    const db = databaseHolder();

    expect(db?.contains(holderOf('r1'))).toBe(true);
    expect(db?.contains(holderOf('r2'))).toBe(true);
    expect(db?.contains(holderOf('c1'))).toBe(true);
    expect(holderOf('r1')?.classList.contains('hidden')).toBe(true);
    expect(holderOf('r2')?.classList.contains('hidden')).toBe(true);
    expect(holderOf('r1')?.contains(holderOf('c1'))).toBe(true);
    expect(db?.contains(holderOf('p2'))).toBe(false);
  });

  it('saves the body blocks under their row', async () => {
    await make(docWithBodies());

    const saved = await editor?.save();
    const body = saved?.blocks.find((block) => block.id === 'c1');
    const row = saved?.blocks.find((block) => block.id === 'r1');

    expect(body?.parent).toBe('r1');
    expect(row?.content).toEqual(['c1']);
  });

  it('places a body block inserted later into its row', async () => {
    await make(docWithBodies());

    const added = editor?.blocks.insertInsideParent('r2', 0, { text: 'new' }, 'paragraph');

    await quiet();

    expect(added?.holder.parentElement?.closest('[data-blok-element]')).toBe(holderOf('r2'));
    expect((await editor?.save())?.blocks.find((block) => block.id === added?.id)?.parent).toBe('r2');
  });

  it('places a row added later inside the database, hidden', async () => {
    await make(docWithBodies());

    const row = editor?.blocks.insertInsideParent('db', 2, { properties: { t: 'Three' }, position: 'a2' }, 'database-row');

    await quiet();

    expect(databaseHolder()?.contains(row?.holder ?? null)).toBe(true);
    expect(row?.holder.classList.contains('hidden')).toBe(true);
  });

  it('a row added after a row that has a page body is still a row', async () => {
    const blok = await make([
      databaseBlock(),
      { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One' }, position: 'a0' }, content: ['c1'] },
      { id: 'c1', type: 'paragraph', parent: 'r1', data: { text: 'first body' } },
      { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Two' }, position: 'a1' }, content: ['c2'] },
      { id: 'c2', type: 'paragraph', parent: 'r2', data: { text: 'second body' } },
    ]);

    blok.blocks.insertAt('database-row', { properties: { t: 'Three' }, position: 'a2' }, { parentId: 'db', position: 'end', id: 'r3' });
    await quiet();

    const saved = (await blok.save()).blocks.find((block) => block.id === 'r3');

    expect(saved?.type).toBe('database-row');
    expect((saved as { parent?: string } | undefined)?.parent).toBe('db');
  });

  it('brings a deleted row back with its body, inside the database, on undo', async () => {
    await make(docWithBodies());

    const index = editor?.blocks.getBlockIndex('r1');

    await editor?.blocks.delete(index);
    await quiet();

    expect(holderOf('c1')).toBeNull();

    editor?.history.undo();
    await quiet();

    expect(databaseHolder()?.contains(holderOf('c1'))).toBe(true);
    expect(holderOf('r1')?.contains(holderOf('c1'))).toBe(true);
    expect(holderOf('r1')?.classList.contains('hidden')).toBe(true);
    expect((await editor?.save())?.blocks.find((block) => block.id === 'c1')?.parent).toBe('r1');
  });

  it('shows the opened row holder as the page body and puts it back on close', async () => {
    await make(docWithBodies());
    await openRow('r1');

    expect(drawerBody()?.contains(holderOf('r1'))).toBe(true);
    expect(holderOf('r1')?.classList.contains('hidden')).toBe(false);
    expect(drawerBody()?.textContent).toContain('first body');

    await pressEscape();

    // The side peek slides out with its body; the body goes back when the slide ends.
    expect(drawerBody()?.contains(holderOf('r1'))).toBe(true);
    await new Promise((resolve) => {
      setTimeout(resolve, 350);
    });

    expect(holder?.querySelector('[data-blok-database-row-pool]')?.contains(holderOf('r1'))).toBe(true);
    expect(holderOf('r1')?.classList.contains('hidden')).toBe(true);
  });

  it('opens a template as a page that shows its body', async () => {
    await make([
      databaseBlock(),
      { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One' }, position: 'a0' } },
      { id: 'tpl', type: 'database-row', parent: 'db', data: { properties: { t: 'Bug' }, position: 'a1', template: true }, content: ['tb'] },
      { id: 'tb', type: 'paragraph', parent: 'tpl', data: { text: 'template body' } },
    ]);

    editor?.blocks.getById('db')?.call('openTemplate', 'tpl' as never);
    await quiet();

    expect(holder?.querySelector('[data-blok-database-template-banner]')).not.toBeNull();
    expect(drawerBody()?.contains(holderOf('tpl'))).toBe(true);
    expect(drawerBody()?.textContent).toContain('template body');
  });

  it('turns a legacy body into child blocks on open, keeps the blob, and adds no undo step', async () => {
    await make(legacyDoc());
    await openRow('r1');

    const saved = await editor?.save();
    const row = saved?.blocks.find((block) => block.id === 'r1');
    const body = saved?.blocks.filter((block) => block.parent === 'r1');

    expect(body?.map((block) => block.id)).toEqual(['r1-body-0', 'r1-body-1']);
    expect(row?.content).toEqual(['r1-body-0', 'r1-body-1']);
    expect((row?.data as { bodyBlocks?: boolean }).bodyBlocks).toBe(true);
    expect((row?.data as { properties: Record<string, unknown> }).properties.d).toEqual(expect.objectContaining({ blocks: expect.any(Array) }));
    expect(drawerBody()?.textContent).toContain('legacy two');

    editor?.history.undo();
    await quiet();

    expect((await editor?.save())?.blocks.filter((block) => block.parent === 'r1')).toHaveLength(2);
  });

  it('preserves a legacy container content order instead of the blob order', async () => {
    const blocks = legacyDoc().map((block) => block.id === 'r1' ? {
      ...block,
      data: {
        properties: {
          t: 'Old',
          d: { blocks: [
            { id: 'parent', type: 'paragraph', data: { text: 'parent' }, content: ['y', 'x'] },
            { id: 'x', type: 'paragraph', parent: 'parent', data: { text: 'first in blob' } },
            { id: 'y', type: 'paragraph', parent: 'parent', data: { text: 'first on page' } },
          ] },
        },
        position: 'a0',
      },
    } : block);

    const blok = await make(blocks);

    await openRow('r1');
    const migrated = (await blok.save()).blocks.find((block) => block.id === 'r1-body-0');

    expect(migrated?.content).toEqual(['r1-body-2', 'r1-body-1']);
    expect(blok.blocks.getChildren('r1-body-0').map((block) => block.id)).toEqual(['r1-body-2', 'r1-body-1']);
  });

  it('retries a partially inserted legacy body without duplicating the children already inserted', async () => {
    let failed = false;

    class FaultInjectedDatabase extends DatabaseTool {
      constructor(options: ConstructorParameters<typeof DatabaseTool>[0]) {
        const insertAt = options.api.blocks.insertAt;

        super({
          ...options,
          api: {
            ...options.api,
            blocks: {
              ...options.api.blocks,
              insertAt: (type, data, placement) => {
                if (placement?.id === 'r1-body-1' && !failed) {
                  failed = true;
                  throw new Error('temporary insert failure');
                }

                return insertAt(type, data, placement);
              },
            },
          },
        });
      }
    }

    const blok = await make(legacyDoc(), false, FaultInjectedDatabase);

    await openRow('r1');
    await pressEscape();
    await new Promise((resolve) => { setTimeout(resolve, 350); });
    await openRow('r1');

    const output = await blok.save();

    expect(output.blocks.filter((block) => block.parent === 'r1').map((block) => block.id))
      .toEqual(['r1-body-0', 'r1-body-1']);
    expect(output.blocks.find((block) => block.id === 'r1')?.data.bodyBlocks).toBe(true);
    expect(failed).toBe(true);
  });

  it('never converts a legacy body again once its blocks were removed', async () => {
    await make(legacyDoc());
    await openRow('r1');
    await editor?.blocks.delete(editor.blocks.getBlockIndex('r1-body-1'));
    await editor?.blocks.delete(editor.blocks.getBlockIndex('r1-body-0'));
    await pressEscape();
    await openRow('r1');

    expect((await editor?.save())?.blocks.filter((block) => block.parent === 'r1')).toHaveLength(0);
  });

  it('offers an empty page body as a placeholder that starts the first paragraph', async () => {
    await make(docWithBodies());
    await openRow('r2');

    const placeholder = drawerBody()?.querySelector<HTMLElement>('[data-blok-database-row-empty]');
    const shown = (): boolean | undefined =>
      placeholder?.matches('[data-blok-database-row-body]:empty ~ [data-blok-database-row-empty]:not(.hidden)');

    expect(shown()).toBe(true);
    expect((await editor?.save())?.blocks.filter((block) => block.parent === 'r2')).toHaveLength(0);

    placeholder?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await quiet();

    const body = (await editor?.save())?.blocks.filter((block) => block.parent === 'r2');

    expect(body?.map((block) => block.type)).toEqual(['paragraph']);
    expect(shown()).toBe(false);
  });

  it('lets a read-only viewer open a row page to read it', async () => {
    await make(docWithBodies(), true);
    await openRow('r1');

    const drawer = holder?.querySelector('[data-blok-database-drawer]');
    const title = drawer?.querySelector<HTMLTextAreaElement>('[data-blok-database-drawer-title]');

    expect(drawer).not.toBeNull();
    expect(title?.readOnly).toBe(true);
    expect(drawerBody()?.contains(holderOf('r1'))).toBe(true);
    expect(drawerBody()?.textContent).toContain('first body');
    expect(drawer?.querySelector('[data-blok-database-drawer-add-prop]')).toBeNull();
  });

  it('opens a board card for a read-only viewer', async () => {
    const blocks = docWithBodies();
    const db = blocks[1];

    db.data = {
      ...db.data,
      schema: [
        { id: 't', name: 'Name', type: 'title', position: 'a0' },
        { id: 's', name: 'Status', type: 'select', position: 'a1', config: { options: [{ id: 'o1', label: 'Todo', position: 'a0' }] } },
      ],
      views: [{ id: 'v', name: 'Board', type: 'board', groupBy: 's', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
    };
    await make(blocks, true);

    holder?.querySelector<HTMLElement>('[data-blok-database-card][data-row-id="r1"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await quiet();

    expect(drawerBody()?.contains(holderOf('r1'))).toBe(true);

    await pressEscape();

    expect(holder?.querySelector('[data-blok-database-drawer][data-open]')).toBeNull();
  });

  it('starts the body from the title with Enter', async () => {
    await make(docWithBodies());
    await openRow('r2');
    holder?.querySelector('[data-blok-database-drawer-title]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await quiet();

    expect((await editor?.save())?.blocks.filter((block) => block.parent === 'r2').map((block) => block.type)).toEqual(['paragraph']);
  });

  it('keeps a row icon on the row and shows it above the title', async () => {
    const blocks = docWithBodies();

    blocks[2] = { ...blocks[2], data: { ...blocks[2].data, icon: '🚀' } };
    await make(blocks);
    await openRow('r1');

    expect(holder?.querySelector('[data-blok-database-drawer-icon]')?.textContent).toBe('🚀');
    expect((await editor?.save())?.blocks.find((block) => block.id === 'r1')?.data.icon).toBe('🚀');
  });

  it('keeps the page open while the icon picker is used', async () => {
    await make(docWithBodies());
    await openRow('r1');
    const picker = document.createElement('div');
    const backdrop = document.createElement('div');

    picker.setAttribute('data-blok-emoji-picker', '');
    picker.appendChild(document.createElement('button'));
    backdrop.setAttribute('data-blok-emoji-picker-backdrop', '');
    document.body.append(picker, backdrop);
    picker.firstElementChild?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await quiet();

    expect(holder?.querySelector('[data-blok-database-drawer][data-open]')).not.toBeNull();
    picker.remove();
    backdrop.remove();
  });

  it('shows a row cover at the top of its page; a writer gets "Add cover", a read-only viewer not', async () => {
    const blocks = docWithBodies();

    blocks[2] = { ...blocks[2], data: { ...blocks[2].data, cover: 'https://example.com/c.png' } };
    await make(blocks);
    await openRow('r1');

    expect(holder?.querySelector<HTMLImageElement>('[data-blok-database-drawer-cover] img')?.getAttribute('src')).toBe('https://example.com/c.png');
    await pressEscape();
    await new Promise((resolve) => {
      setTimeout(resolve, 350);
    });
    await openRow('r2');
    holder?.querySelector<HTMLElement>('[data-blok-database-drawer-add-cover]')?.click();

    expect(document.querySelector('[data-role="audio-cover-picker"]')).not.toBeNull();
    expect(holder?.querySelector('[data-blok-database-drawer][data-open]')).not.toBeNull();
    document.querySelector('[data-role="audio-cover-picker"]')?.remove();

    editor?.destroy();
    holder?.replaceChildren();
    await make(blocks, true);
    await openRow('r2');

    expect(holder?.querySelector('[data-blok-database-drawer-add-cover]')).toBeNull();
  });

  it('never paints an unsafe cover URL', async () => {
    const blocks = docWithBodies();

    blocks[2] = { ...blocks[2], data: { ...blocks[2].data, cover: 'javascript:alert(1)' } };
    await make(blocks);
    await openRow('r1');

    expect(holder?.querySelector('[data-blok-database-drawer-cover]')).toBeNull();
  });

  it('offers "Add icon" on a page with none, never to a read-only viewer', async () => {
    await make(docWithBodies());
    await openRow('r2');

    expect(holder?.querySelector('[data-blok-database-drawer-add-icon]')).not.toBeNull();

    editor?.destroy();
    holder?.replaceChildren();
    await make(docWithBodies(), true);
    await openRow('r2');

    expect(holder?.querySelector('[data-blok-database-drawer-add-icon]')).toBeNull();
  });

  it('opens its page when find reveals a match in a closed row', async () => {
    await make(docWithBodies());

    editor?.blocks.getById('r1')?.call('expand');
    await quiet();

    expect(drawerBody()?.contains(holderOf('c1'))).toBe(true);
    expect(holderOf('r1')?.classList.contains('hidden')).toBe(false);
  });

  it('declares the row a layout container that never nests another row', () => {
    expect(DatabaseRowTool.isLayout).toBe(true);
    expect(DatabaseRowTool.deletesChildren).toBe(true);
    expect(DatabaseRowTool.childTools).toEqual({ deny: ['database-row'] });
  });
});

describe('row page properties panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    vi.restoreAllMocks();
  });

  const withProperties = (): OutputBlockData[] => {
    const blocks = docWithBodies();

    blocks[1] = {
      ...blocks[1],
      data: {
        ...blocks[1].data,
        schema: [
          { id: 't', name: 'Name', type: 'title', position: 'a0' },
          { id: 'n', name: 'Notes', type: 'text', position: 'a1' },
          { id: 'h', name: 'Secret', type: 'text', position: 'a2', pageVisibility: 'hidden' },
          { id: 'e', name: 'Maybe', type: 'text', position: 'a3', pageVisibility: 'hideWhenEmpty' },
        ],
      },
    };

    return blocks;
  };

  const shownProperties = (): string[] =>
    [...(holder?.querySelectorAll('[data-blok-database-drawer-prop-label]') ?? [])].map((label) => label.textContent ?? '');

  // research/09 §5b L91: "2 more properties".
  it('gathers hidden properties into one "N more properties" item that shows them', async () => {
    await make(withProperties());
    await openRow('r1');

    expect(shownProperties()).toEqual(['Notes']);

    const reveal = holder?.querySelector<HTMLElement>('[data-blok-database-drawer-hidden-props]');

    expect(reveal?.textContent).toBe('2 more properties');
    reveal?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // By name (R12).
    expect(shownProperties()).toEqual(['Maybe', 'Notes', 'Secret']);
  });

  it('folds the shown hidden properties back with the same item', async () => {
    await make(withProperties());
    await openRow('r1');
    const reveal = (): HTMLElement | null | undefined => holder?.querySelector<HTMLElement>('[data-blok-database-drawer-hidden-props]');

    expect(reveal()?.getAttribute('aria-expanded')).toBe('false');
    reveal()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(reveal()?.getAttribute('aria-expanded')).toBe('true');
    expect(reveal()?.textContent).toBe('Hide 2 properties');
    reveal()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(shownProperties()).toEqual(['Notes']);
    expect(reveal()?.getAttribute('aria-expanded')).toBe('false');
  });

  // feel/findings-rowpage R11: a classic page shows its properties with no "Properties" fold above them.
  it('shows the properties with no Properties toggle on a classic page', async () => {
    await make(withProperties());
    await openRow('r1');

    expect(holder?.querySelector('[data-blok-database-drawer-props-toggle]')).toBeNull();
    expect(holder?.querySelector<HTMLElement>('[data-blok-database-drawer-props]')?.hidden).toBe(false);
  });
});
