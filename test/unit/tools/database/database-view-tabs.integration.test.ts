import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import type { API, OutputBlockData, OutputData } from '../../../../types';
import type { DatabaseData, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

interface TestEditor {
  isReady: Promise<unknown>;
  save(): Promise<OutputData>;
  destroy(): void;
  blocks: API['blocks'];
  history: API['history'];
  readOnly: API['readOnly'];
}

let editor: Blok | undefined;
let holder: HTMLDivElement | undefined;

const quiet = async (): Promise<void> => {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  for (let frame = 0; frame < 3; frame++) {
    await new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
  }
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
};

const table = (id: string, position: string, extra: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id, name: 'Table', type: 'table', position, filters: [], sorts: [], visibleProperties: [], ...extra,
});

const schema: PropertyDefinition[] = [
  { id: 't', name: 'Name', type: 'title', position: 'a0' },
  { id: 'notes', name: 'Notes', type: 'text', position: 'a1' },
];

const doc = (views: DatabaseViewConfig[] = [table('v1', 'a0'), table('v2', 'a1')]): OutputBlockData[] => [
  { id: 'db', type: 'database', content: ['r1'], data: { title: 'Projects', schema, views, activeViewId: views[0].id } },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'Row', notes: 'n' }, position: 'a0' } },
];

const make = async (blocks: OutputBlockData[], database: typeof DatabaseTool = DatabaseTool): Promise<TestEditor> => {
  if (holder === undefined) throw new Error('missing editor holder');
  let ready: TestEditor | undefined;

  editor = new Blok({
    holder, dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      database: { class: database },
      'database-row': DatabaseRowTool,
    },
    data: { blocks },
    onReady: (api) => { ready = api; },
  });
  await editor.isReady;
  await quiet();
  if (ready === undefined) throw new Error('editor did not expose its ready API');

  return ready;
};

const parentRoot = (): HTMLElement => {
  const found = holder?.querySelector<HTMLElement>('[data-blok-element][data-blok-id="db"]');

  if (found === null || found === undefined) throw new Error('missing parent database');

  return found;
};

const own = (selector: string): HTMLElement => {
  const root = parentRoot();
  const found = [...root.querySelectorAll<HTMLElement>(selector)].find((el) => el.closest('[data-blok-element]') === root);

  if (found === undefined) throw new Error('missing ' + selector);

  return found;
};

const settingsPanel = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-database-panel]');

const addViewFromMenu = async (type: string): Promise<void> => {
  own('[data-blok-database-add-view]').click();
  await quiet();
  const tile = document.querySelector<HTMLElement>(`[data-blok-database-view-option="${type}"]`);

  if (tile === null) throw new Error('no ' + type + ' tile');
  tile.click();
  await quiet();
};

const tab = (viewId: string): HTMLElement => own(`[data-blok-database-tab][data-view-id="${viewId}"]`);

const menuItems = (): string[] => [...document.querySelectorAll<HTMLElement>('[data-blok-popover-opened="true"] [data-blok-popover-items] > [data-blok-item-name]')]
  .map((item) => item.getAttribute('data-blok-item-name') ?? '');

const menuItem = (name: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[data-blok-popover-opened="true"] [data-blok-item-name="${name}"]`);

  if (found === null) throw new Error('no menu item ' + name);

  return found;
};

const viewIds = async (api: TestEditor): Promise<string[]> =>
  (((await api.save()).blocks.find((b) => b.id === 'db')?.data as DatabaseData | undefined)?.views ?? []).map((v) => v.id);

const confirmDialog = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-database-confirm-dialog]');

describe('view tabs (feel/findings-toolbar)', () => {
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
    PopoverRegistry.resetForTests();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('V05: Add view opens the new view\'s settings', () => {
    it('a layout picked in Add view opens the settings panel on the new view', async () => {
      await make(doc());

      await addViewFromMenu('board');

      expect(settingsPanel()).not.toBeNull();
      expect(own('[data-blok-database-tab][data-active]').textContent).toContain('Board');
    });

    it('a Form opens its question prompt instead', async () => {
      await make(doc());

      await addViewFromMenu('form');

      expect(settingsPanel()).toBeNull();
    });

    it('a view added by code opens nothing', async () => {
      const api = await make(doc());

      const block = api.blocks.getById('db');

      // BlockAPI.call types its argument as an object; addView takes the layout name.
      if (block !== null) Reflect.apply(block.call, block, ['addView', 'board']);
      await quiet();

      expect(settingsPanel()).toBeNull();
    });
  });
  describe('V06: a click on the active tab opens the view menu', () => {
    it('opens the menu on the active tab', async () => {
      await make(doc());

      tab('v1').click();
      await quiet();

      expect(menuItems()).toContain('database-view-rename');
    });

    it('a click on another tab only switches to it', async () => {
      await make(doc());

      tab('v2').click();
      await quiet();

      expect(menuItems()).toEqual([]);
      expect(own('[data-blok-database-tab][data-active]').getAttribute('data-view-id')).toBe('v2');
    });

    it('a read-only database opens no menu', async () => {
      const api = await make(doc());

      await api.readOnly.set(true);
      await quiet();

      tab('v1').click();
      await quiet();

      expect(menuItems()).toEqual([]);
    });
  });

  describe("V07: the view menu takes Notion's order and labels", () => {
    // notion-motion.md Round 14: "Open as full page" sits between Copy link to view and Hide data source titles.
    it('lists Rename, Display as, Edit view, Source · Copy link to view, Open as full page, Hide data source titles · Duplicate view, Delete view', async () => {
      await make(doc());

      tab('v1').click();
      await quiet();

      expect(menuItems()).toEqual([
        'database-view-rename',
        'database-tab-display',
        'database-view-edit',
        'database-view-source',
        'database-view-copy-link',
        'database-view-full-page',
        'database-view-data-source-titles',
        'database-view-duplicate',
        'database-view-delete',
      ]);
      expect(menuItem('database-view-duplicate').textContent).toContain('Duplicate view');
      expect(menuItem('database-view-delete').textContent).toContain('Delete view');
    });

    // notion-motion.md Round 94 §1 #4: Table and Board both focus the panel's Close button.
    it.each([
      ['table', table('v1', 'a0')],
      ['board', table('v1', 'a0', { type: 'board', name: 'Board' })],
    ])('Edit view on a %s focuses View settings\' Close button', async (_layout, view) => {
      await make(doc([view, table('v2', 'a1')]));

      tab('v1').click();
      await quiet();
      menuItem('database-view-edit').click();
      await quiet();

      expect(settingsPanel()?.querySelector('[data-blok-testid="database-panel-close"]')).toHaveFocus();
    });

    // notion-motion.md Round 110 §1 #3 (r110-n-source-opens.raw): Source opens its panel over the tab menu, which stays open.
    // Escape closes the panel only; focus goes back to the Source row.
    describe('Source', () => {
      const tabMenuOpen = (): boolean => document.querySelector('[data-blok-popover-opened="true"] [data-blok-item-name="database-view-source"]') !== null;
      const openSource = async (): Promise<void> => {
        await make(doc());
        tab('v1').click();
        await quiet();
        menuItem('database-view-source').click();
        await quiet();
      };

      it('opens the source panel and keeps the tab menu open under it', async () => {
        await openSource();

        expect(settingsPanel()).not.toBeNull();
        expect(settingsPanel()?.querySelector('input')).toHaveFocus();
        expect(tabMenuOpen()).toBe(true);
      });

      // notion-motion.md Round 111 §1 #3: Source keeps its tint while its panel is open, and drops it after Escape.
      it('marks the Source row open while its panel is up', async () => {
        await openSource();

        expect(menuItem('database-view-source')).toHaveAttribute('data-blok-popover-item-children-open', 'true');
        expect(menuItem('database-view-source')).toHaveAttribute('aria-expanded', 'true');

        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await quiet();

        expect(menuItem('database-view-source')).not.toHaveAttribute('data-blok-popover-item-children-open');
      });

      it('Escape closes the source panel only and puts focus back on the Source row', async () => {
        await openSource();

        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await quiet();

        expect(settingsPanel()).toBeNull();
        expect(tabMenuOpen()).toBe(true);
        // Blok's menus hold DOM focus on the list and mark the row with the cursor.
        expect(menuItem('database-view-source').closest('[data-blok-popover-items]')).toHaveFocus();
        expect(menuItem('database-view-source').getAttribute('data-blok-focused')).toBe('true');
      });
    });

    it('Copy link to view copies the link of the view it was opened on', async () => {
      const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);

      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      await make(doc());

      tab('v2').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      await quiet();
      menuItem('database-view-copy-link').click();
      await quiet();

      expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/#view-v2$/));
    });
  });

  describe('V24: every Delete view asks first', () => {
    it('Cancel keeps the view', async () => {
      const api = await make(doc());

      tab('v2').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      await quiet();
      menuItem('database-view-delete').click();
      await quiet();

      expect(confirmDialog()?.textContent).toContain('Delete this view?');
      document.querySelector<HTMLElement>('[data-blok-database-confirm-action="cancel"]')?.click();
      await quiet();

      expect(await viewIds(api)).toEqual(['v1', 'v2']);
    });

    it('Delete view removes it', async () => {
      const api = await make(doc());

      tab('v2').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      await quiet();
      menuItem('database-view-delete').click();
      await quiet();
      document.querySelector<HTMLElement>('[data-blok-database-confirm-action="confirm"]')?.click();
      await quiet();

      expect(await viewIds(api)).toEqual(['v1']);
    });

    // notion-motion.md Round 27 §3 (r27-tab-delete-dlg.raw): "Delete view" has focus on open.
    it('focuses Delete view when the confirm opens', async () => {
      await make(doc());

      tab('v2').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      await quiet();
      menuItem('database-view-delete').click();
      await quiet();

      expect(document.querySelector('[data-blok-database-confirm-action="confirm"]')).toHaveFocus();
    });
  });

  // notion-motion.md Round 27 §3 (r27-tab-dup-after.raw): the copy of "Table" is "Table (1)", and View settings
  // opens with "View name" focused and its text fully selected.
  describe('Duplicate view', () => {
    const duplicate = async (): Promise<void> => {
      tab('v1').click();
      await quiet();
      menuItem('database-view-duplicate').click();
      await quiet();
    };

    it('names the copy "<name> (1)"', async () => {
      const api = await make(doc());

      await duplicate();

      const views = ((await api.save()).blocks.find((b) => b.id === 'db')?.data as DatabaseData | undefined)?.views ?? [];

      expect(views.map((v) => v.name)).toEqual(['Table', 'Table', 'Table (1)']);
    });

    it('opens View settings with the name selected', async () => {
      await make(doc());

      await duplicate();

      const name = settingsPanel()?.querySelector<HTMLInputElement>('[data-blok-testid="database-settings-view-name"]');

      expect(name).toBeInstanceOf(HTMLInputElement);
      expect(name).toHaveFocus();
      expect([name?.selectionStart, name?.selectionEnd]).toEqual([0, 'Table (1)'.length]);
    });
  });
  describe('V03: the title row "…" with one view', () => {
    const titleMore = (): HTMLElement | null => parentRoot().querySelector<HTMLElement>('[data-blok-database-title-row] [data-blok-database-title-more]');

    const menuGroups = (): string[][] => [...document.querySelectorAll<HTMLElement>('[data-blok-popover-opened="true"] [data-blok-popover-items] > *')]
      .reduce<string[][]>((groups, item) => {
        const name = item.getAttribute('data-blok-item-name');

        if (name !== null) groups[groups.length - 1].push(name);
        else if (item.getAttribute('data-blok-testid') === 'popover-item-separator') groups.push([]);

        return groups;
      }, [[]]);

    it('sits after "+" and lists Notion\'s groups: view, title and layout, then Hide title', async () => {
      await make(doc([table('v1', 'a0')]));

      expect(titleMore()?.previousElementSibling?.hasAttribute('data-blok-database-add-view')).toBe(true);
      titleMore()?.click();
      await quiet();

      expect(menuGroups()).toEqual([
        ['database-title-copy-link', 'database-title-duplicate'],
        ['database-title-edit', 'database-title-edit-layout'],
        ['database-title-hide'],
      ]);
    });

    it('Hide title hides the title and saves it; the "…" stays and offers Show title', async () => {
      const api = await make(doc([table('v1', 'a0')]));

      titleMore()?.click();
      await quiet();
      menuItem('database-title-hide').click();
      await quiet();

      expect(own('[data-blok-database-title]').hidden).toBe(true);
      expect(((await api.save()).blocks.find((b) => b.id === 'db')?.data as DatabaseData).hideDataSourceTitles).toBe(true);
      titleMore()?.click();
      await quiet();

      expect(menuItem('database-title-hide').textContent).toContain('Show title');
      expect(menuItems()).not.toContain('database-title-edit');
      menuItem('database-title-hide').click();
      await quiet();

      expect(own('[data-blok-database-title]').hidden).toBe(false);
      expect(((await api.save()).blocks.find((b) => b.id === 'db')?.data as DatabaseData).hideDataSourceTitles).toBeUndefined();
    });

    it('Edit layout opens the first row page in Customize layout', async () => {
      await make(doc([table('v1', 'a0')]));

      titleMore()?.click();
      await quiet();
      menuItem('database-title-edit-layout').click();
      await quiet();

      expect(document.querySelector('[data-blok-database-layout-apply]')).not.toBeNull();
    });

    it('Duplicate view adds a second view', async () => {
      const api = await make(doc([table('v1', 'a0')]));

      titleMore()?.click();
      await quiet();
      menuItem('database-title-duplicate').click();
      await quiet();

      expect(await viewIds(api)).toHaveLength(2);
    });

    it('Edit title puts the caret in the title', async () => {
      await make(doc([table('v1', 'a0')]));

      titleMore()?.click();
      await quiet();
      menuItem('database-title-edit').click();
      await quiet();

      expect(own('[data-blok-database-title]')).toHaveFocus();
    });

    it('is not drawn when read-only', async () => {
      const api = await make(doc([table('v1', 'a0')]));

      await api.readOnly.set(true);
      await quiet();

      expect(titleMore()).toBeNull();
    });
  });

  // notion-motion.md Round 110 §1 #2 (r110-n-titlemore-2views.raw): with two views the title row's ⋯ shows on hover,
  // 4 after the title. Blok keeps it in the row so Tab still reaches it (database.css shows it on hover and focus).
  describe('the title row "…" with two views', () => {
    const titleMore = (): HTMLElement | null => parentRoot().querySelector<HTMLElement>('[data-blok-database-title-row] [data-blok-database-title-more]');

    it('sits right after the title and opens the title menu', async () => {
      await make(doc());

      expect(titleMore()?.previousElementSibling?.hasAttribute('data-blok-database-title')).toBe(true);
      titleMore()?.click();
      await quiet();

      expect(menuItems()).toEqual(expect.arrayContaining(['database-title-edit']));
    });

    // notion-motion.md Round 111 §1 #2 (r111-n-titlemore-menu-2views.raw): View database, Edit title, Edit icon,
    // Edit layout | Hide title (Manage in Calendar is Notion's own app). Copy link and Duplicate stay in the tab menu.
    it('lists Notion\'s two-view groups', async () => {
      await make(doc());

      titleMore()?.click();
      await quiet();

      const groups = [...document.querySelectorAll<HTMLElement>('[data-blok-popover-opened="true"] [data-blok-popover-items] > *')]
        .reduce<string[][]>((all, item) => {
          const name = item.getAttribute('data-blok-item-name');

          if (name !== null) all[all.length - 1].push(name);
          else if (item.getAttribute('data-blok-testid') === 'popover-item-separator') all.push([]);

          return all;
        }, [[]]);

      expect(groups).toEqual([
        ['database-title-view-database', 'database-title-edit', 'database-title-edit-icon', 'database-title-edit-layout'],
        ['database-title-hide'],
      ]);
    });

    // r111-n-titlemore-menu-2views.raw: 200 wide, 28px rows (the header menu look).
    it('is the 200px menu with 28px rows', async () => {
      await make(doc());

      titleMore()?.click();
      await quiet();
      const popover = document.querySelector<HTMLElement>('[data-blok-popover-opened="true"]');

      expect(popover?.getAttribute('data-blok-popover-custom-class')?.split(' ')).toContain('blok-database-header-menu');
      // jsdom measures 0, so --width is the 200px floor.
      expect(popover?.style.getPropertyValue('--width')).toBe('200px');
    });

    it('View database opens the database as a full page', async () => {
      await make(doc());

      titleMore()?.click();
      await quiet();
      menuItem('database-title-view-database').click();
      await quiet();

      expect(parentRoot().closest('[data-blok-database-full-open-target]')).not.toBeNull();
      // The full page names the database in the URL.
      history.replaceState(null, '', '/');
    });

    it('Edit icon opens the icon picker', async () => {
      await make(doc());

      titleMore()?.click();
      await quiet();
      menuItem('database-title-edit-icon').click();
      await quiet();

      expect(document.querySelector('[data-blok-emoji-picker]')).not.toBeNull();
    });

    it('is not drawn when read-only', async () => {
      const api = await make(doc());

      await api.readOnly.set(true);
      await quiet();

      expect(titleMore()).toBeNull();
    });
  });
});

