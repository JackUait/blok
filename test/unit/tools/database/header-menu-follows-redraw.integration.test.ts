import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import type { OutputBlockData } from '../../../../types';
import type { DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

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

const schema = (prefix: string): PropertyDefinition[] => [
  { id: `${prefix}t`, name: 'Name', type: 'title', position: 'a0' },
  {
    id: `${prefix}st`, name: 'Stage', type: 'status', position: 'a1',
    config: { options: [
      { id: `${prefix}todo`, label: 'Not started', color: 'gray', position: 'a0', groupId: 'todo' },
      { id: `${prefix}doing`, label: 'Doing', color: 'blue', position: 'a1', groupId: 'inProgress' },
    ] },
  },
  { id: `${prefix}notes`, name: 'Notes', type: 'text', position: 'a2' },
];

/** `db` shows its own table (v1) or a view of the `src` database inside it (vb). */
const doc = (active: 'v1' | 'vb'): OutputBlockData[] => [
  {
    id: 'db', type: 'database', content: ['r1', 'src'],
    data: { title: 'Projects', schema: schema(''), views: [table('v1', 'a0'), table('vb', 'a1', { dataSourceId: 'src' })], activeViewId: active },
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'Own row', st: 'todo' }, position: 'a0' } },
  {
    id: 'src', type: 'database', parent: 'db', content: ['b1'],
    data: { title: 'Source', schema: schema('b'), views: [table('bv', 'a0')], activeViewId: 'bv' },
  },
  { id: 'b1', type: 'database-row', parent: 'src', data: { properties: { bt: 'Source row', bst: 'btodo' }, position: 'a0' } },
];

const make = async (blocks: OutputBlockData[]): Promise<void> => {
  if (holder === undefined) throw new Error('missing editor holder');
  editor = new Blok({
    holder, dataModel: 'hierarchical',
    tools: { paragraph: Paragraph, database: { class: DatabaseTool }, 'database-row': DatabaseRowTool },
    data: { blocks },
  });
  await editor.isReady;
  await quiet();
};

/** The header shown in the parent's view area, never the hidden source block's own. */
const shownHeader = (propertyId: string): HTMLElement => {
  const root = holder?.querySelector<HTMLElement>('[data-blok-element][data-blok-id="db"]');
  const found = [...(root?.querySelectorAll<HTMLElement>(`[role="columnheader"][data-property-id="${propertyId}"]`) ?? [])]
    .find((el) => el.closest('[data-blok-element]') === root);

  if (found === undefined) throw new Error('missing shown header ' + propertyId);

  return found;
};

const openMenu = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-blok-popover][data-blok-popover-opened="true"]:has([data-blok-database-property-menu-name-input])');

const must = <T extends Element>(found: T | null | undefined, what: string): T => {
  if (found === null || found === undefined) throw new Error('missing ' + what);

  return found;
};

const openHeaderMenu = async (propertyId: string): Promise<HTMLElement> => {
  shownHeader(propertyId).click();
  await quiet();

  return must(openMenu(), 'header menu');
};

const openEditProperty = async (menu: HTMLElement): Promise<void> => {
  must(menu.querySelector<HTMLElement>('[data-blok-item-name="editProperty"]'), 'Edit property row').click();
  await quiet();
};

/** A scroll inside the page: the popover closes on it when the header it stands on is gone. */
const scrollInside = (): void => {
  shownHeader(propertyIds.current).closest('[data-blok-database-table-scroller]')?.dispatchEvent(new Event('scroll'));
};

const propertyIds = { current: '' };

const setDefault = async (optionId: string): Promise<void> => {
  const row = must(document.querySelector(`[data-blok-database-select-option="${optionId}"]`), 'option row');

  must(row.querySelector<HTMLElement>('[data-blok-database-select-option-menu]'), 'option menu').click();
  await quiet();
  must(document.querySelector<HTMLElement>('[data-blok-database-option-set-default]'), 'Set as default').click();
  await quiet();
};

const rename = async (menu: HTMLElement, name: string): Promise<void> => {
  const input = must(menu.querySelector<HTMLInputElement>('[data-blok-database-property-menu-name-input]'), 'name field');

  // A typed name saves when the field loses focus, as when the user goes on to another row of the menu.
  input.focus();
  input.value = name;
  input.dispatchEvent(new Event('input'));
  input.blur();
  input.dispatchEvent(new Event('change'));
  await quiet();
};

describe('the column header menu follows its header through a redraw', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
    // jsdom measures every box as 0×0. Here a box in the page is measurable and a removed one is not, as in a browser.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return this.isConnected ? DOMRect.fromRect({ x: 40, y: 100, width: 200, height: 33 }) : DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
    });
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    PopoverRegistry.resetForTests();
    vi.restoreAllMocks();
  });

  describe('in its own table', () => {
    beforeEach(() => {
      propertyIds.current = 'st';
    });

    it('Status "Set as default" moves the menu onto the redrawn header', { timeout: 30000 }, async () => {
      await make(doc('v1'));
      const before = shownHeader('st');
      const menu = await openHeaderMenu('st');

      await openEditProperty(menu);
      await setDefault('doing');

      expect(before.isConnected, 'the edit must redraw the table').toBe(false);
      expect(openMenu(), 'the redraw itself keeps the menu').toBe(menu);
      scrollInside();
      await quiet();
      expect(openMenu()).toBe(menu);
    });

    it('a rename moves the menu onto the redrawn header', { timeout: 30000 }, async () => {
      await make(doc('v1'));
      const before = shownHeader('st');
      const menu = await openHeaderMenu('st');

      await rename(menu, 'Phase');

      expect(shownHeader('st').textContent).toContain('Phase');
      expect(before.isConnected, 'the rename must redraw the table').toBe(false);
      expect(openMenu(), 'the redraw itself keeps the menu').toBe(menu);
      scrollInside();
      await quiet();
      expect(openMenu()).toBe(menu);
    });
  });

  // A linked view redraws a moment later, by remounting the view, which would destroy the menu.
  // It holds that redraw while the menu is open and draws the edit when the menu closes.
  describe('in a linked view', () => {
    beforeEach(() => {
      propertyIds.current = 'bst';
    });

    const savedStage = async (): Promise<PropertyDefinition | undefined> => {
      const saved = await editor?.save();
      const source = saved?.blocks.find((block) => block.id === 'src')?.data as { schema: PropertyDefinition[] } | undefined;

      return source?.schema.find((property) => property.id === 'bst');
    };

    const closeWithEscape = async (menu: HTMLElement): Promise<void> => {
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await quiet();
      if (openMenu() !== null) {
        must(openMenu(), 'header menu').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await quiet();
      }
    };

    it('Status "Set as default" keeps the menu open, then the table shows it', { timeout: 30000 }, async () => {
      await make(doc('vb'));
      const menu = await openHeaderMenu('bst');

      await openEditProperty(menu);
      await setDefault('bdoing');

      expect(openMenu(), 'the delayed redraw keeps the menu').toBe(menu);
      scrollInside();
      await quiet();
      expect(openMenu()).toBe(menu);
      expect((await savedStage())?.status?.defaultOptionId).toBe('bdoing');
    });

    it('a rename keeps the menu open, then the table shows the new name', { timeout: 30000 }, async () => {
      await make(doc('vb'));
      const menu = await openHeaderMenu('bst');

      await rename(menu, 'Phase');

      expect(openMenu(), 'the delayed redraw keeps the menu').toBe(menu);
      scrollInside();
      await quiet();
      expect(openMenu()).toBe(menu);
      expect((await savedStage())?.name).toBe('Phase');
      await closeWithEscape(menu);
      expect(openMenu()).toBeNull();
      expect(shownHeader('bst').textContent).toContain('Phase');
    });
  });
});
