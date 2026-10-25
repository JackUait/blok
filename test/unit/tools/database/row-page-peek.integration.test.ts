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

const make = async (blocks: OutputBlockData[], config: Record<string, unknown> = {}, readOnly = false): Promise<void> => {
  editor = new Blok({
    holder,
    readOnly,
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
    // jsdom has no matchMedia; the emoji picker reads it for its theme when the icon picker opens.
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
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

  it('opens the row page body inert when the host denies editContent', async () => {
    await make(doc(), { permissions: { can: (action: string) => action !== 'editContent' } });
    await openRow('r1');
    const body = drawer()?.querySelector('[data-blok-database-drawer-editor]');

    expect(body).not.toBeNull();
    expect(body?.closest('[inert]')).not.toBeNull();
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

  describe('a full row page takes over the editor', () => {
    afterEach(() => {
      window.history.replaceState(null, '', window.location.pathname);
    });

    it('hides the rest of the editor and names the row in the URL; its Back undoes both', async () => {
      await make([{ id: 'p', type: 'paragraph', data: { text: 'Above' } }, ...doc()]);
      await openRow('r2');
      await click(q('[data-blok-database-peek-expand]'));

      expect(drawer()?.getAttribute('data-peek-mode')).toBe('full');
      expect(q('[data-blok-editor]')?.hasAttribute('data-blok-database-row-page')).toBe(true);
      expect(q('[data-blok-id="db"]')?.hasAttribute('data-blok-database-row-page-path')).toBe(true);
      expect(q('[data-blok-id="p"]')?.hasAttribute('data-blok-database-row-page-path')).toBe(false);
      expect(window.location.hash).toBe('#r2?full');

      await click(q('[data-blok-database-drawer-close]'));
      await quiet();

      expect(q('[data-blok-editor]')?.hasAttribute('data-blok-database-row-page')).toBe(false);
      expect(window.location.hash).toBe('');
    });

    it('closes when the browser goes back', async () => {
      await make(doc({ openPagesIn: 'full' }));
      await openRow('r2');

      expect(window.location.hash).toBe('#r2?full');
      window.history.replaceState(null, '', window.location.pathname);
      window.dispatchEvent(new PopStateEvent('popstate'));
      await quiet();

      expect(q('[data-blok-database-drawer][data-open]')).toBeNull();
      expect(q('[data-blok-editor]')?.hasAttribute('data-blok-database-row-page')).toBe(false);
    });

    it('reopens as a full page from its URL', async () => {
      window.history.replaceState(null, '', '#r2?full');
      await make(doc());

      expect(drawer()?.getAttribute('data-peek-mode')).toBe('full');
      expect(shownTitle()).toBe('Two');
      expect(q('[data-blok-editor]')?.hasAttribute('data-blok-database-row-page')).toBe(true);
    });
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

  it('opens the row a copied link points at (#rowId) when the page loads, and only once', async () => {
    window.history.replaceState(null, '', '#r2');
    try {
      await make(doc());

      expect(shownTitle()).toBe('Two');

      await key({ key: 'Escape' });
      editor?.destroy();
      await make(doc());

      expect(q('[data-blok-database-drawer][data-open]')).toBeNull();
    } finally {
      window.history.replaceState(null, '', window.location.pathname);
    }
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

  it('steps rows with Ctrl+Shift+J and Ctrl+Shift+K on a Mac, and ignores plain Ctrl+J there', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    await make(doc());
    await openRow('r2');
    await key({ key: 'j', code: 'KeyJ', ctrlKey: true });

    expect(shownTitle()).toBe('Two');

    await key({ key: 'J', code: 'KeyJ', ctrlKey: true, shiftKey: true });

    expect(shownTitle()).toBe('Three');

    await key({ key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true });
    await key({ key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true });

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

  it('hands the expand button to the host navigate lever when there is one', async () => {
    const navigate = vi.fn();

    await make(doc(), {
      rowPages: {
        lookup: vi.fn().mockResolvedValue(null),
        copyFromLegacy: vi.fn(),
        reconcileLegacy: vi.fn(),
        mount: vi.fn(() => ({ destroy: vi.fn() })),
        navigate,
      },
    });
    await openRow('r1');
    await click(q('[data-blok-database-peek-expand]'));

    expect(navigate).toHaveBeenCalledWith('r1');
    expect(q('[data-blok-database-wrapper]')?.hasAttribute('data-blok-database-full-page')).toBe(false);
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

  it('opens and prefills a new row of a view filtered only by an advanced filter', async () => {
    const blocks = doc({ filterTree: { id: 'root', conjunction: 'and', filterRules: [{ id: 'r1', propertyId: 'n', operator: 'equals', value: 'Draft' }] } });

    (blocks[0].data as { schema: unknown[] }).schema.push({ id: 'n', name: 'Notes', type: 'text', position: 'a1' });
    await make(blocks);
    await click(q('[data-blok-database-table-add-row]'));

    const saved = (await editor?.save())?.blocks.filter((block) => block.type === 'database-row').at(-1);

    expect(drawer()?.getAttribute('data-peek-mode')).toBe('side');
    expect((saved?.data as { properties: Record<string, unknown> }).properties.n).toBe('Draft');
  });

  it('opens a new row of a view filtered only by a personal (unsaved) filter in its peek', async () => {
    const blocks = doc();

    (blocks[0].data as { schema: unknown[] }).schema.push({ id: 'n', name: 'Notes', type: 'text', position: 'a1' });
    await make(blocks);
    await click(q('[data-blok-testid="database-toolbar-filter"]'));
    await click(document.querySelector('[data-blok-testid="database-pick-property-n"]'));
    const input = document.querySelector<HTMLInputElement>('[data-blok-testid="database-filter-value"]');

    if (input !== null) {
      input.value = 'Draft';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await quiet();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await quiet();

    expect(((await editor?.save())?.blocks[0].data as { views: Array<{ filters: unknown[] }> }).views[0].filters).toEqual([]);
    await click(q('[data-blok-database-table-add-row]'));

    expect(drawer()?.getAttribute('data-peek-mode')).toBe('side');
  });

  it('prefills a "Me" person filter with the signed-in person id from config.people.me', async () => {
    const blocks = doc({ filters: [{ propertyId: 'own', operator: 'contains', value: ['me'] }] });

    (blocks[0].data as { schema: unknown[] }).schema.push({ id: 'own', name: 'Owner', type: 'person', position: 'a1' });
    await make(blocks, { people: { me: () => 'u-ada', list: async () => [{ id: 'u-ada', name: 'Ada' }] } });
    await click(q('[data-blok-database-table-add-row]'));

    const saved = (await editor?.save())?.blocks.filter((block) => block.type === 'database-row').at(-1);

    expect((saved?.data as { properties: Record<string, unknown> }).properties.own).toEqual([{ id: 'u-ada' }]);
  });

  // research/35 §9: one Escape in the page heading saves the title and closes the peek.
  it('Escape in the peek title saves the typed title and closes the peek', async () => {
    await make(doc());
    await openRow('r1');
    const title = q<HTMLTextAreaElement>('[data-blok-database-drawer-title]');

    if (title === null) throw new Error('no title');
    title.focus();
    title.value = 'OneY';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await quiet();

    expect(q('[data-blok-database-drawer][data-open]')).toBeNull();
    const saved = (await editor?.save())?.blocks.find((block) => block.id === 'r1');

    expect((saved?.data as { properties: Record<string, unknown> }).properties.t).toBe('OneY');
    expect(q('[data-row-id="r1"]')?.textContent).toContain('OneY');
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

  it.each([
    ['table', {}, '[data-row-id="r1"] [role="gridcell"]'],
    ['board', { type: 'board', groupBy: 's' }, '[data-blok-database-card][data-row-id="r1"]'],
    ['list', { type: 'list' }, '[data-blok-database-list-row][data-row-id="r1"]'],
    ['gallery', { type: 'gallery' }, '[data-blok-database-gallery-card][data-row-id="r1"], [data-row-id="r1"]'],
  ])('shows the page icon in a %s view, unless the view hides page icons', async (_name, view, rowSelector) => {
    const withIcon = (hide: boolean): OutputBlockData[] => {
      const blocks = doc({ ...view, ...(hide ? { showPageIcon: false } : {}) });

      (blocks[0].data as { schema: unknown[] }).schema.push({
        id: 's', name: 'Status', type: 'select', position: 'a1', config: { options: [{ id: 'o1', label: 'Todo', position: 'a0' }] },
      });
      blocks[1] = { ...blocks[1], data: { ...blocks[1].data, icon: '🚀', properties: { t: 'One', s: 'o1' } } };

      return blocks;
    };
    const iconIn = (): string | null | undefined => q(rowSelector)?.querySelector('[data-blok-database-page-icon]')?.textContent;

    await make(withIcon(false));
    expect(iconIn()).toBe('🚀');

    editor?.destroy();
    holder?.replaceChildren();
    await make(withIcon(true));
    expect(iconIn()).toBeUndefined();
  });

  describe('timeline', () => {
    const timelineDoc = (): OutputBlockData[] => {
      const blocks = doc({ type: 'timeline', timelineBy: 'due', showTimelineTable: true });
      const today = new Date();
      const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      (blocks[0].data as { schema: unknown[] }).schema.push({ id: 'due', name: 'Due', type: 'date', position: 'a1' });
      [1, 2, 3].forEach((i) => {
        blocks[i] = { ...blocks[i], data: { ...blocks[i].data, properties: { ...(blocks[i].data as { properties: Record<string, unknown> }).properties, due: day } } };
      });

      return blocks;
    };
    const bar = (rowId: string): HTMLElement | null => q(`[data-blok-database-timeline-row][data-row-id="${rowId}"] [data-blok-database-timeline-bar], [data-row-id="${rowId}"] [data-blok-database-timeline-bar], [data-blok-database-timeline-bar][data-row-id="${rowId}"]`);

    it.each([false, true])('opens a row from its bar (read-only: %s)', async (readOnly) => {
      editor = new Blok({
        holder,
        readOnly,
        dataModel: 'hierarchical',
        tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
        data: { blocks: timelineDoc() },
      } as never) as unknown as TestEditor;
      await editor.isReady;
      await quiet();

      expect(bar('r2')).not.toBeNull();
      await click(bar('r2'));

      expect(shownTitle()).toBe('Two');
    });

    it('Cmd/Ctrl-click on bars picks rows into the selection bar instead of opening them', async () => {
      await make(timelineDoc());
      bar('r1')?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
      await quiet();
      bar('r2')?.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      await quiet();

      expect(drawer()).toBeNull();
      expect(q('[data-blok-database-table-selection-count]')?.textContent).toBe('2 selected');
    });
  });

  describe('board and list selection', () => {
    const boardDoc = (type: 'board' | 'list'): OutputBlockData[] => {
      const blocks = doc({ type, ...(type === 'board' ? { groupBy: 's' } : {}), visibleProperties: ['d'] });

      blocks[0].data = {
        ...blocks[0].data,
        schema: [
          { id: 't', name: 'Name', type: 'title', position: 'a0' },
          { id: 's', name: 'Status', type: 'select', position: 'a1', config: { options: [{ id: 'o1', label: 'Todo', position: 'a0' }] } },
          { id: 'd', name: 'Done', type: 'checkbox', position: 'a2' },
        ],
      };
      [1, 2, 3].forEach((i) => {
        blocks[i] = { ...blocks[i], data: { ...blocks[i].data, properties: { ...(blocks[i].data as { properties: Record<string, unknown> }).properties, s: 'o1' } } };
      });

      return blocks;
    };
    const rowEl = (rowId: string): HTMLElement | null => q(`[data-blok-database-card][data-row-id="${rowId}"], [data-blok-database-list-row][data-row-id="${rowId}"]`);
    const modClick = async (rowId: string, init: MouseEventInit): Promise<void> => {
      rowEl(rowId)?.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));
      await quiet();
    };
    const savedRows = async (): Promise<Array<{ id?: string; data: { properties: Record<string, unknown> } }>> =>
      ((await editor?.save())?.blocks ?? [])
        .filter((block) => block.type === 'database-row')
        .map((block) => ({ id: block.id, data: { properties: (block.data.properties ?? {}) as Record<string, unknown> } }));

    it.each(['board', 'list'] as const)('in a %s, Cmd/Ctrl-click and Shift-click select rows gray, with the bar, and never open them', async (type) => {
      await make(boardDoc(type));
      await modClick('r1', { metaKey: true });
      await modClick('r3', { shiftKey: true });

      expect(drawer()).toBeNull();
      expect(['r1', 'r2', 'r3'].map((id) => rowEl(id)?.getAttribute('aria-selected'))).toEqual(['true', 'true', 'true']);
      expect(q('[data-blok-database-table-selection-count]')?.textContent).toBe('3 selected');

      await key({ key: 'Escape' });

      expect(rowEl('r1')?.getAttribute('aria-selected')).not.toBe('true');
      expect(q('[data-blok-database-table-selection-bar]')).toBeNull();
    });

    it('a bar property button edits every selected card', async () => {
      await make(boardDoc('board'));
      await modClick('r1', { metaKey: true });
      await modClick('r2', { ctrlKey: true });
      await click(q('[data-blok-database-table-selection-property][data-property-id="d"]'));

      expect((await savedRows()).map((row) => row.data.properties.d)).toEqual([true, true, undefined]);
    });

    it('trash, Cmd/Ctrl+D and Cmd/Ctrl+/ act on the selection', async () => {
      await make(boardDoc('list'));
      await modClick('r2', { metaKey: true });
      await key({ key: 'd', ctrlKey: true });

      expect(await savedRows()).toHaveLength(4);

      await key({ key: '/', ctrlKey: true });
      expect([...document.querySelectorAll('[data-blok-popover-item]')].map((item) => item.textContent?.trim())).toContain('Done');

      await click(q('[data-blok-database-table-selection-delete]'));
      expect((await savedRows()).map((row) => row.id)).not.toContain('r2');
    });
  });

  // feel/findings-rowpage R19: in Notion a pick changes only this peek; "Edit view default" changes the view.
  it('switches only the open peek from the header, leaving the view default alone', async () => {
    await make(doc());
    await openRow('r1');
    await click(q('[data-blok-database-peek-mode]'));

    const center = [...document.querySelectorAll<HTMLElement>('[data-blok-popover-item]')]
      .find((item) => item.textContent?.includes('Center peek'));

    await click(center ?? null);

    expect(drawer()?.getAttribute('data-peek-mode')).toBe('center');
    expect((await savedView())?.openPagesIn).toBeUndefined();

    await key({ key: 'Escape' });
    await openRow('r2');

    expect(drawer()?.getAttribute('data-peek-mode')).toBe('side');
  });

  it('lists the three modes by title only, then "Edit view default", which opens the view\'s Layout settings', async () => {
    await make(doc());
    await openRow('r1');
    await click(q('[data-blok-database-peek-mode]'));
    const menu = document.querySelector<HTMLElement>('[data-blok-popover-opened]');
    const items = [...(menu?.querySelectorAll<HTMLElement>('[data-blok-popover-item]') ?? [])];

    expect(items.map((item) => item.textContent?.trim())).toStrictEqual(['Side peek', 'Center peek', 'Full page', 'Edit view default']);
    expect(menu?.querySelector('[data-blok-database-peek-mode-description]')).toBeNull();

    await click(items[3] ?? null);

    expect(document.querySelector('[data-blok-popover-opened]')?.textContent).toContain('Open pages in');
  });

  // One Escape = one layer: the menu first, the peek on the next press.
  // Read-only has no editor keyboard handling, so the popover registry's own backstop closes the menu.
  it.each([false, true])('closes only the Open pages in menu on the first Escape, and the peek on the second (read-only: %s)', async (readOnly) => {
    await make(doc(), {}, readOnly);
    await openRow('r1');
    const trigger = q('[data-blok-database-peek-mode]');

    await click(trigger);
    trigger?.focus();
    expect(drawer()?.hasAttribute('data-open')).toBe(true);
    expect(document.querySelector('[data-blok-popover-opened]')).not.toBeNull();

    trigger?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await quiet();

    expect(drawer()?.hasAttribute('data-open')).toBe(true);
    expect(document.querySelector('[data-blok-popover-opened]')).toBeNull();
    expect(q('[data-blok-component="database"]')?.hasAttribute('data-blok-navigation-focused')).toBe(false);

    trigger?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await quiet();

    expect(drawer()?.hasAttribute('data-open') ?? false).toBe(false);
  });

  // Blok is published: closing a popover must not hide the Escape from a host's own listeners.
  it.each([false, true])('still lets a window listener see the Escape that closed the Open pages in menu (read-only: %s)', async (readOnly) => {
    await make(doc(), {}, readOnly);
    await openRow('r1');
    const trigger = q('[data-blok-database-peek-mode]');

    await click(trigger);
    trigger?.focus();
    expect(document.querySelector('[data-blok-popover-opened]')).not.toBeNull();

    const seen: KeyboardEvent[] = [];
    const onKeydown = (event: KeyboardEvent): void => {
      seen.push(event);
    };

    window.addEventListener('keydown', onKeydown);
    try {
      trigger?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await quiet();
    } finally {
      window.removeEventListener('keydown', onKeydown);
    }

    expect(seen).toHaveLength(1);
    expect(seen[0]?.defaultPrevented).toBe(false);
    expect(document.querySelector('[data-blok-popover-opened]')).toBeNull();
    expect(drawer()?.hasAttribute('data-open')).toBe(true);
  });
});
