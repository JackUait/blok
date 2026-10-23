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

      api.blocks.getById('db')?.call('addView', 'board');
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
      await make(doc());
      await editor?.readOnly.set(true);
      await quiet();

      tab('v1').click();
      await quiet();

      expect(menuItems()).toEqual([]);
    });
  });

  describe("V07: the view menu takes Notion's order and labels", () => {
    it('lists Rename, Display as, Edit view · Copy link to view, Hide data source titles · Duplicate view, Delete view', async () => {
      await make(doc());

      tab('v1').click();
      await quiet();

      expect(menuItems()).toEqual([
        'database-view-rename',
        'database-tab-display',
        'database-view-edit',
        'database-view-copy-link',
        'database-view-data-source-titles',
        'database-view-duplicate',
        'database-view-delete',
      ]);
      expect(menuItem('database-view-duplicate').textContent).toContain('Duplicate view');
      expect(menuItem('database-view-delete').textContent).toContain('Delete view');
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
  });
  describe('V03: the title row "…" with one view', () => {
    const titleMore = (): HTMLElement | null => parentRoot().querySelector<HTMLElement>('[data-blok-database-title-row] [data-blok-database-title-more]');

    it('sits after "+" and lists Copy link to view, Duplicate view, then Edit title', async () => {
      await make(doc([table('v1', 'a0')]));

      expect(titleMore()?.previousElementSibling?.hasAttribute('data-blok-database-add-view')).toBe(true);
      titleMore()?.click();
      await quiet();

      expect(menuItems()).toEqual(['database-title-copy-link', 'database-title-duplicate', 'database-title-edit']);
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

    it('is not drawn with two views, nor when read-only', async () => {
      await make(doc());

      expect(titleMore()).toBeNull();
      editor?.destroy();
      editor = undefined;
      await make(doc([table('v1', 'a0')]));
      await editor?.readOnly.set(true);
      await quiet();

      expect(titleMore()).toBeNull();
    });
  });
});

