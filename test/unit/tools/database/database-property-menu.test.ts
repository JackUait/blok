import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { PropertyDefinition, PropertyType } from '../../../../src/tools/database/types';
import { createDefaultStatusSettings } from '../../../../src/tools/database/property-values';
import { IconInfo, IconPageLayout, IconReplace } from '../../../../src/components/icons';

interface CapturedItem {
  name?: string;
  title?: string;
  icon?: string;
  valueLabel?: string;
  valueIcon?: HTMLElement;
  closeOnActivate?: boolean;
  trailingIcon?: string;
  type?: string;
  isActive?: boolean | (() => boolean);
  isDestructive?: boolean;
  element?: HTMLElement;
  onActivate?: (item: CapturedItem) => void;
  confirmation?: { onActivate: (item: CapturedItem) => void; title?: string };
  children?: { items: CapturedItem[]; searchable?: boolean; width?: string; minWidth?: string };
}

interface CapturedPopover { items: CapturedItem[]; destroyed: boolean; params: Record<string, unknown>; activated: string[]; focused: string[]; closed?: () => void; hide: () => void; transitionAtShow?: string }

const captured = vi.hoisted((): { popovers: CapturedPopover[] } => ({ popovers: [] }));

vi.mock('../../../../src/components/utils/popover', () => ({
  PopoverDesktop: class {
    readonly record: CapturedPopover;
    readonly element = document.createElement('div');

    constructor(params: { items: CapturedItem[] }) {
      this.record = { items: params.items, destroyed: false, params, activated: [], focused: [], hide: () => this.hide() };
      this.element.appendChild(document.createElement('div')).setAttribute('data-blok-popover-container', '');
      captured.popovers.push(this.record);
    }

    getElement(): HTMLElement {
      return this.element;
    }

    closeSubmenuOnEscape(): boolean {
      return false;
    }

    activateItemByName(name: string): void {
      this.record.activated.push(name);
    }

    focusItemByName(name: string): boolean {
      this.record.focused.push(name);

      return true;
    }

    show(): void {
      this.record.transitionAtShow = this.element.querySelector<HTMLElement>('[data-blok-popover-container]')?.style.transition;
      // Mounts the html rows so a test can see what has focus.
      for (const item of this.record.items) {
        if (item.type === 'html' && item.element !== undefined) document.body.appendChild(item.element);
      }
    }

    on(_event: string, handler: () => void): void {
      this.record.closed = handler;
    }

    hide(): void {
      this.record.closed?.();
    }

    destroy(): void {
      this.record.destroyed = true;
    }
  },
}));

const { DatabasePropertyMenu, propertyMenuEntries } = await import('../../../../src/tools/database/database-property-menu');

const prop = (type: PropertyType, extra: Partial<PropertyDefinition> = {}): PropertyDefinition => ({ id: 'p', name: 'Amount', type, position: 'a1', ...extra });

const callbacks = () => ({
  onRename: vi.fn(),
  onUpdate: vi.fn(),
  onOptionsChange: vi.fn(),
  onChangeType: vi.fn(),
  onDuplicate: vi.fn(),
  onDelete: vi.fn(),
});

const lastItems = (): CapturedItem[] => captured.popovers[captured.popovers.length - 1]?.items ?? [];
const byName = (items: CapturedItem[], name: string): CapturedItem => {
  const item = items.find((i) => i.name === name);

  if (item === undefined) throw new Error(`no item ${name} in ${items.map((i) => i.name).join(',')}`);

  return item;
};

describe('property menu entries (research/08 header menus, property-level items)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each<[PropertyType, string[]]>([
    // research/08: the Title list has no description row.
    ['title', []],
    ['text', ['changeType', 'visibility', 'duplicate', 'delete']],
    ['number', ['editProperty', 'changeType', 'visibility', 'duplicate', 'delete']],
    ['select', ['editProperty', 'changeType', 'visibility', 'duplicate', 'delete']],
    ['multiSelect', ['editProperty', 'changeType', 'visibility', 'duplicate', 'delete']],
    ['status', ['editProperty', 'displayAs', 'changeType', 'visibility', 'duplicate', 'delete']],
    ['date', ['editProperty', 'changeType', 'visibility', 'duplicate', 'delete']],
    ['checkbox', ['changeType', 'visibility', 'duplicate', 'delete']],
    ['files', ['changeType', 'visibility', 'duplicate', 'delete']],
    ['createdTime', ['editProperty', 'changeType', 'visibility', 'duplicate', 'delete']],
    ['uniqueId', ['editProperty', 'visibility', 'delete']],
    ['person', ['editProperty', 'changeType', 'visibility', 'duplicate', 'delete']],
  ])('%s → %j', (type, entries) => {
    expect(propertyMenuEntries(prop(type))).toEqual(entries);
  });
});

describe('DatabasePropertyMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captured.popovers.length = 0;
  });

  it('the title menu has no description row and does not end on a separator', () => {
    const menu = new DatabasePropertyMenu({ i18n: { t: (key: string) => key, getLocale: () => 'en' } as never, hasPeople: false, ...callbacks() });

    menu.open(prop('title'), document.createElement('button'), [{ type: 'default', title: 'tools.database.tableFilter' } as never]);
    const items = lastItems();

    expect(items.some((i) => i.name === 'description')).toBe(false);
    expect(items[items.length - 1]?.type).not.toBe('separator');
    menu.destroy();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  // A row page peek is in the top layer: an icon picker on body would paint under it.
  it('opens the icon picker inside the top-layer panel the menu was opened from', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const peek = document.createElement('div');
    const anchor = document.createElement('button');

    peek.setAttribute('data-blok-top-layer', 'true');
    peek.appendChild(anchor);
    document.body.appendChild(peek);
    const menu = new DatabasePropertyMenu({ i18n: { t: (key: string) => key, getLocale: () => 'en' } as never, hasPeople: false, ...callbacks() });

    menu.open(prop('text'), anchor);
    const name = lastItems().find((i) => i.name === 'name')?.element;

    document.body.appendChild(name ?? document.createElement('div'));
    name?.querySelector<HTMLElement>('[data-blok-database-property-menu-icon]')?.click();

    expect(document.querySelector('[data-blok-emoji-picker]')?.closest('[data-blok-top-layer]')).toBe(peek);
    menu.destroy();
    vi.unstubAllGlobals();
  });

  // research/09 §1b: a row page property menu ends with "Customize layout".
  it('ends the menu with Customize layout after a separator when the host offers it', () => {
    const onCustomizeLayout = vi.fn();
    const menu = new DatabasePropertyMenu({ i18n: { t: (key: string) => key, getLocale: () => 'en' } as never, hasPeople: false, ...callbacks(), onCustomizeLayout });

    menu.open(prop('text'), document.createElement('button'));
    const items = lastItems();
    const last = items[items.length - 1];

    expect(items[items.length - 2]?.type).toBe('separator');
    expect(last?.name).toBe('customize-layout');
    expect(last?.title).toBe('tools.database.layoutCustomize');
    expect(last?.icon).toBe(IconPageLayout);
    last?.onActivate?.(last);

    expect(onCustomizeLayout).toHaveBeenCalledTimes(1);
    menu.destroy();
  });

  // feel/findings-table T11: every row of Notion's column header menu has a glyph.
  it.each<PropertyType>([
    'title', 'text', 'number', 'select', 'multiSelect', 'status', 'date', 'person', 'files', 'checkbox', 'url', 'email', 'phone',
    'formula', 'relation', 'rollup', 'createdTime', 'createdBy', 'lastEditedTime', 'lastEditedBy', 'button', 'uniqueId', 'place',
  ])('gives every %s property row an icon', (type) => {
    const menu = new DatabasePropertyMenu({ i18n: { t: (key: string) => key, getLocale: () => 'en' } as never, hasPeople: true, ...callbacks() });

    menu.open(prop(type, type === 'status' ? { status: createDefaultStatusSettings() } : {}), document.createElement('button'));

    expect(lastItems().filter((i) => (i.type ?? 'default') === 'default' && (i.icon ?? '') === '').map((i) => i.title)).toEqual([]);
    menu.destroy();
  });

  it('has no Customize layout without the host lever', () => {
    const menu = new DatabasePropertyMenu({ i18n: { t: (key: string) => key, getLocale: () => 'en' } as never, hasPeople: false, ...callbacks() });

    menu.open(prop('text'), document.createElement('button'));

    expect(lastItems().some((i) => i.name === 'customize-layout')).toBe(false);
    menu.destroy();
  });

  const open = (property: PropertyDefinition, hasPeople = false): ReturnType<typeof callbacks> => {
    const cb = callbacks();
    const menu = new DatabasePropertyMenu({ i18n: { t: (key: string) => key, getLocale: () => 'en' } as never, hasPeople, ...cb });

    menu.open(property, document.createElement('button'));

    return cb;
  };

  it('draws the name as a field box: Blok\'s shared text field (findings K04)', () => {
    open(prop('text'));
    const root = byName(lastItems(), 'name').element as HTMLElement;

    expect(root.querySelector('[data-blok-database-property-menu-name-input]')?.getAttribute('data-blok-field')).toBe('text');
  });

  it('opens and closes with the database menu motion, like the other database menus', () => {
    open(prop('text'));

    const params = captured.popovers[captured.popovers.length - 1]?.params;

    expect(String(params?.class).split(' ')).toEqual(['blok-database-menu', 'blok-database-header-menu']);
    expect(params?.animateClose).toBe(true);
  });

  it.each(['close', 'Enter'] as const)('notifies its host once when closed through %s', (method) => {
    const onClose = vi.fn();
    const menu = new DatabasePropertyMenu({
      i18n: { t: (key: string) => key, getLocale: () => 'en' } as never,
      hasPeople: false,
      ...callbacks(),
      onClose,
    });

    menu.open(prop('title'), document.createElement('button'));
    if (method === 'close') {
      menu.close();
    } else {
      const field = byName(lastItems(), 'name').element?.querySelector('input');

      if (field === null || field === undefined) throw new Error('no name field');
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }

    expect(onClose).toHaveBeenCalledTimes(1);
    menu.close();
    menu.destroy();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renames from the name field on Enter', () => {
    const cb = open(prop('text'));
    const field = byName(lastItems(), 'name').element?.querySelector('input');

    if (field === null || field === undefined) throw new Error('no name field');
    field.value = 'Budget';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(cb.onRename).toHaveBeenCalledWith('p', 'Budget');
  });

  it('never renames to an empty name', () => {
    const cb = open(prop('text'));
    const field = byName(lastItems(), 'name').element?.querySelector('input');

    if (field === null || field === undefined) throw new Error('no name field');
    field.value = '   ';
    field.dispatchEvent(new Event('change'));

    expect(cb.onRename).not.toHaveBeenCalled();
  });

  it('changes type from the Change type list, which leaves out the current type and the title', () => {
    const cb = open(prop('text'));
    const types = byName(lastItems(), 'changeType').children?.items ?? [];

    expect(types.map((t) => t.name)).not.toContain('type-text');
    expect(types.map((t) => t.name)).not.toContain('type-title');
    expect(types.map((t) => t.name)).not.toContain('type-person');
    byName(types, 'type-number').onActivate?.(byName(types, 'type-number'));

    expect(cb.onChangeType).toHaveBeenCalledWith('p', 'number');
  });

  it('offers Person in Change type only with a people directory', () => {
    open(prop('text'), true);

    expect((byName(lastItems(), 'changeType').children?.items ?? []).map((t) => t.name)).toContain('type-person');
  });

  it('asks before deleting', () => {
    const cb = open(prop('text'));
    const del = byName(lastItems(), 'delete');

    expect(del.onActivate).toBeUndefined();
    expect(del.isDestructive).toBe(true);
    del.confirmation?.onActivate(del);

    expect(cb.onDelete).toHaveBeenCalledWith('p');
  });

  it('duplicates', () => {
    const cb = open(prop('text'));

    byName(lastItems(), 'duplicate').onActivate?.(byName(lastItems(), 'duplicate'));

    expect(cb.onDuplicate).toHaveBeenCalledWith('p');
  });

  it('sets page visibility and marks the current one', () => {
    const cb = open(prop('text', { pageVisibility: 'hideWhenEmpty' }));
    const options = byName(lastItems(), 'visibility').children?.items ?? [];
    const active = options.find((o) => (typeof o.isActive === 'function' ? o.isActive() : o.isActive === true));

    expect(active?.name).toBe('visibility-hideWhenEmpty');
    byName(options, 'visibility-hidden').onActivate?.(byName(options, 'visibility-hidden'));

    expect(cb.onUpdate).toHaveBeenCalledWith('p', { pageVisibility: 'hidden' });
  });

  // research/30 X2: no "Property description" row; the (i) opens a field inside the menu.
  describe('the description field (research/30 X2)', () => {
    const openMenu = (property: PropertyDefinition): { cb: ReturnType<typeof callbacks>; menu: InstanceType<typeof DatabasePropertyMenu>; row: HTMLElement; info: HTMLButtonElement; area: HTMLTextAreaElement; box: HTMLElement } => {
      const cb = callbacks();
      const menu = new DatabasePropertyMenu({ i18n: { t: (key: string) => key, getLocale: () => 'en' } as never, hasPeople: false, ...cb });

      menu.open(property, document.createElement('button'));
      const row = byName(lastItems(), 'name').element;
      const info = row?.querySelector<HTMLButtonElement>('[data-blok-database-property-menu-description-button]');
      const area = row?.querySelector<HTMLTextAreaElement>('textarea[data-blok-database-property-description]');
      const box = area?.parentElement;

      if (row === undefined || info === null || info === undefined || area === null || area === undefined || box === null || box === undefined) {
        throw new Error('no description field in the name row');
      }
      document.body.appendChild(row);

      return { cb, menu, row, info, area, box };
    };

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('has no "Property description" menu item', () => {
      openMenu(prop('text'));

      expect(lastItems().some((i) => i.name === 'description')).toBe(false);
    });

    it('the (i) is labelled "Add property description", sits after the name input and draws the info glyph', () => {
      const { info } = openMenu(prop('text'));

      expect(info.getAttribute('aria-label')).toBe('tools.database.addPropertyDescription');
      expect(info.type).toBe('button');
      const glyph = document.createElement('span');

      glyph.innerHTML = IconInfo;
      expect(info.innerHTML).toBe(glyph.innerHTML);
      expect(info.previousElementSibling?.hasAttribute('data-blok-database-property-menu-name-input')).toBe(true);
    });

    it('the field starts hidden when there is no description, and the (i) shows and focuses it', () => {
      const { info, area, box } = openMenu(prop('text'));

      expect(box.hidden).toBe(true);
      info.click();

      expect(box.hidden).toBe(false);
      expect(area).toHaveFocus();
      expect(area.placeholder).toBe('tools.database.propertyDescriptionPlaceholder');
      expect(area.rows).toBe(2);
      expect(area.getAttribute('data-blok-field')).toBe('text');
      // It opens no submenu.
      expect(captured.popovers.at(-1)?.activated).toEqual([]);
    });

    it('a second click on the (i) hides the field again', () => {
      const { info, box } = openMenu(prop('text'));

      info.click();
      info.click();

      expect(box.hidden).toBe(true);
    });

    // research/35 §5: a saved description does not reopen the field; the (i) does.
    it('with a description, the field stays closed until the (i), and the (i) reads "Edit property description"', () => {
      const { info, area, box } = openMenu(prop('text', { description: 'What we spend' }));

      expect(box.hidden).toBe(true);
      expect(area.value).toBe('What we spend');
      expect(info.getAttribute('aria-label')).toBe('tools.database.editPropertyDescription');
      info.click();
      expect(box.hidden).toBe(false);
      expect(area).toHaveFocus();
    });

    // research/35 §5: click 1 opens, click 2 closes with the text kept, click 3 opens again.
    it('the (i) toggles the field and keeps the text', () => {
      const { info, area, box } = openMenu(prop('text'));

      info.click();
      area.value = 'Typed';
      info.click();
      expect(box.hidden).toBe(true);
      info.click();
      expect(box.hidden).toBe(false);
      expect(area.value).toBe('Typed');
    });

    // research/35 §5: Shift+Enter adds a line, so it must not be blocked.
    it('Shift+Enter is left to the field', () => {
      const { info, area } = openMenu(prop('text'));

      info.click();
      const shiftEnter = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true });

      area.dispatchEvent(shiftEnter);

      expect(shiftEnter.defaultPrevented).toBe(false);
    });

    // research/35 §4: the (i) has no tooltip.
    it('the (i) has no hint', () => {
      const { info } = openMenu(prop('text'));

      expect(info.title).toBe('');
      expect(info.hasAttribute('aria-describedby')).toBe(false);
    });

    it('Enter adds no new line and does not close the menu', () => {
      const { menu, info, area } = openMenu(prop('text'));

      info.click();
      const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });

      area.dispatchEvent(enter);

      expect(enter.defaultPrevented).toBe(true);
      expect(menu.isOpen).toBe(true);
    });

    it('closing the menu saves the typed text once', () => {
      const { cb, menu, info, area } = openMenu(prop('text'));

      info.click();
      area.value = 'What we spend';
      area.dispatchEvent(new Event('change'));
      menu.close();

      expect(cb.onUpdate).toHaveBeenCalledTimes(1);
      expect(cb.onUpdate).toHaveBeenCalledWith('p', { description: 'What we spend' });
    });

    it('a menu closed by Escape or a click outside saves the text before onClose', () => {
      const cb = callbacks();
      const order: string[] = [];
      const menu = new DatabasePropertyMenu({
        i18n: { t: (key: string) => key, getLocale: () => 'en' } as never,
        hasPeople: false,
        ...cb,
        onUpdate: () => order.push('update'),
        onClose: () => order.push('close'),
      });

      menu.open(prop('text'), document.createElement('button'));
      const area = byName(lastItems(), 'name').element?.querySelector('textarea');

      if (area === null || area === undefined) throw new Error('no description field');
      area.value = 'Typed';
      captured.popovers.at(-1)?.hide();

      expect(order).toEqual(['update', 'close']);
    });

    it('closing with an emptied field clears the description', () => {
      const { cb, menu, area } = openMenu(prop('text', { description: 'Old' }));

      area.value = '  ';
      menu.close();

      expect(cb.onUpdate).toHaveBeenCalledWith('p', { description: undefined });
    });

    it('closing without a change saves nothing', () => {
      const { cb, menu } = openMenu(prop('text', { description: 'Same' }));

      menu.close();

      expect(cb.onUpdate).not.toHaveBeenCalled();
    });
  });

  it('the title has no description, so its name field has no (i) button', () => {
    open(prop('title'));

    expect(byName(lastItems(), 'name').element?.querySelector('[data-blok-database-property-menu-description-button]')).toBeNull();
  });

  it('labels a button column edit entry "Edit automation", like Notion (research/08)', () => {
    open(prop('button'));
    const buttonTitle = byName(lastItems(), 'editProperty').title;

    open(prop('number'));

    expect(buttonTitle).toBe('tools.database.editAutomation');
    expect(byName(lastItems(), 'editProperty').title).toBe('tools.database.editProperty');
  });

  it('switches a status between select and checkbox display', () => {
    const status = createDefaultStatusSettings();
    const cb = open(prop('status', { status }));
    const options = byName(lastItems(), 'displayAs').children?.items ?? [];

    byName(options, 'displayAs-checkbox').onActivate?.(byName(options, 'displayAs-checkbox'));

    expect(cb.onUpdate).toHaveBeenCalledWith('p', { status: { ...status, showAs: 'checkbox' } });
  });

  describe('Edit property for a person (research/16 §5)', () => {
    const editItems = (property: PropertyDefinition): { cb: ReturnType<typeof callbacks>; items: CapturedItem[] } => {
      const cb = open(property, true);

      return { cb, items: byName(lastItems(), 'editProperty').children?.items ?? [] };
    };
    const choices = (row: CapturedItem): Array<[string | undefined, string | undefined, boolean]> =>
      (row.children?.items ?? []).map((i) => [i.name, i.title, i.isActive === true]);

    it('has Limit, Default and Notifications, each showing its current value', () => {
      const { items } = editItems(prop('person'));

      expect(items.map((i) => [i.name, i.title, i.valueLabel])).toEqual([
        ['limit', 'tools.database.relationLimit', 'tools.database.relationLimitNone'],
        ['personDefault', 'tools.database.personDefault', 'tools.database.personDefaultNone'],
        ['personNotifications', 'tools.database.personNotifications', 'tools.database.personNotificationsUsersOnly'],
      ]);
    });

    it('lists the options in Notion\'s order with No limit, No default and Users only checked', () => {
      const { items } = editItems(prop('person'));

      expect(choices(byName(items, 'limit'))).toEqual([
        ['limit-one', 'tools.database.personLimitOne', false],
        ['limit-none', 'tools.database.relationLimitNone', true],
      ]);
      expect(choices(byName(items, 'personDefault'))).toEqual([
        ['personDefault-none', 'tools.database.personDefaultNone', true],
        ['personDefault-createdBy', 'tools.database.propertyTypeCreatedBy', false],
      ]);
      expect(choices(byName(items, 'personNotifications'))).toEqual([
        ['personNotifications-usersAndGroups', 'tools.database.personNotificationsUsersAndGroups', false],
        ['personNotifications-usersOnly', 'tools.database.personNotificationsUsersOnly', true],
        ['personNotifications-none', 'tools.database.personNotificationsNone', false],
      ]);
    });

    it('shows and checks the stored choices', () => {
      const { items } = editItems(prop('person', { person: { limit: 1, default: 'createdBy', notifications: 'none' } }));

      expect(items.map((i) => i.valueLabel)).toEqual([
        'tools.database.personLimitOne',
        'tools.database.propertyTypeCreatedBy',
        'tools.database.personNotificationsNone',
      ]);
      expect(byName(byName(items, 'limit').children?.items ?? [], 'limit-one').isActive).toBe(true);
      expect(byName(byName(items, 'personDefault').children?.items ?? [], 'personDefault-createdBy').isActive).toBe(true);
      expect(byName(byName(items, 'personNotifications').children?.items ?? [], 'personNotifications-none').isActive).toBe(true);
    });

    it('writes each choice and drops the key when the default comes back', () => {
      const { cb, items } = editItems(prop('person', { person: { limit: 1, notifications: 'none' } }));
      const pick = (row: string, name: string): void => {
        const item = byName(byName(items, row).children?.items ?? [], name);

        item.onActivate?.(item);
      };

      pick('personDefault', 'personDefault-createdBy');
      pick('limit', 'limit-none');
      pick('personNotifications', 'personNotifications-usersAndGroups');
      pick('personNotifications', 'personNotifications-usersOnly');

      expect(cb.onUpdate.mock.calls.map((call): unknown => call[1])).toEqual([
        { person: { limit: 1, notifications: 'none', default: 'createdBy' } },
        { person: { notifications: 'none' } },
        { person: { limit: 1, notifications: 'usersAndGroups' } },
        { person: { limit: 1 } },
      ]);
    });
  });

  describe('Edit property for a number', () => {
    const editItems = (property: PropertyDefinition): CapturedItem[] => {
      open(property);

      return byName(lastItems(), 'editProperty').children?.items ?? [];
    };

    it('lists Number, Number with separators, Percent and the 42 currencies, searchable', () => {
      const format = byName(editItems(prop('number')), 'numberFormat');

      expect(format.children?.items).toHaveLength(45);
      expect(format.children?.searchable).toBe(true);
      expect(format.children?.items.slice(0, 3).map((i) => i.name)).toEqual(['format-number', 'format-number_with_commas', 'format-percent']);
    });

    it('sets the format, decimals and show-as, keeping the other number settings', () => {
      const cb = open(prop('number', { number: { format: 'euro', showAs: 'bar' } }));
      const items = byName(lastItems(), 'editProperty').children?.items ?? [];
      const decimals = byName(items, 'decimals').children?.items ?? [];

      byName(decimals, 'decimals-2').onActivate?.(byName(decimals, 'decimals-2'));
      expect(cb.onUpdate).toHaveBeenCalledWith('p', { number: { format: 'euro', showAs: 'bar', decimals: 2 } });

      byName(items, 'showAs').element?.querySelector<HTMLElement>('[data-blok-database-show-as-tile="ring"]')?.click();
      expect(cb.onUpdate).toHaveBeenLastCalledWith('p', { number: { format: 'euro', showAs: 'ring' } });
    });

    it('offers color and divide-by only for a bar or ring', () => {
      expect(editItems(prop('number')).map((i) => i.name)).not.toContain('color');
      expect(editItems(prop('number', { number: { showAs: 'bar' } })).map((i) => i.name)).toEqual(expect.arrayContaining(['color', 'divideBy']));
    });

    const headerMenu = (property: PropertyDefinition): { cb: ReturnType<typeof callbacks>; menu: InstanceType<typeof DatabasePropertyMenu>; onClose: ReturnType<typeof vi.fn> } => {
      const cb = callbacks();
      const onClose = vi.fn();
      const menu = new DatabasePropertyMenu({ i18n: { t: (key: string) => key, getLocale: () => 'en' } as never, hasPeople: false, ...cb, onClose });

      menu.open(property, document.createElement('button'), [{ type: 'default', name: 'view-filter', title: 'tools.database.tableFilter' } as never]);

      return { cb, menu, onClose };
    };
    const headerTile = (value: string): HTMLElement => {
      const edit = byName(lastItems(), 'editProperty').children?.items ?? [];
      const found = byName(edit, 'showAs').element?.querySelector<HTMLElement>(`[data-blok-database-show-as-tile="${value}"]`);

      if (found === null || found === undefined) throw new Error(`no ${value} tile`);

      return found;
    };
    const editNames = (): Array<string | undefined> => (byName(lastItems(), 'editProperty').children?.items ?? []).map((i) => i.name);

    it('picking Bar in the header submenu brings in Color and Divide by at once, the submenu still open', () => {
      const { menu, onClose } = headerMenu(prop('number'));

      headerTile('bar').click();

      expect(editNames()).toEqual(expect.arrayContaining(['color', 'divideBy']));
      expect(captured.popovers[0]?.destroyed).toBe(true);
      expect(onClose).not.toHaveBeenCalled();
      expect(menu.isOpen).toBe(true);
      expect(captured.popovers[captured.popovers.length - 1]?.activated).toEqual(['editProperty']);
      expect(lastItems().some((i) => i.name === 'view-filter')).toBe(true);
      expect(headerTile('bar').getAttribute('aria-checked')).toBe('true');
      menu.destroy();
    });

    it('picking Number in the header submenu takes Color and Divide by away at once', () => {
      const { menu } = headerMenu(prop('number', { number: { showAs: 'ring' } }));

      headerTile('number').click();

      expect(editNames()).not.toContain('color');
      expect(editNames()).not.toContain('divideBy');
      menu.destroy();
    });

    it('picking Bar in the header submenu saves a typed name and keeps it in the field', () => {
      const { cb, menu } = headerMenu(prop('number'));
      const input = byName(lastItems(), 'name').element?.querySelector('input');

      if (input === null || input === undefined) throw new Error('no name input');
      input.value = 'Memo';
      headerTile('bar').click();

      expect(cb.onRename).toHaveBeenCalledWith('p', 'Memo');
      expect(byName(lastItems(), 'name').element?.querySelector('input')?.value).toBe('Memo');
      menu.destroy();
    });

    // A write redraws the board, so the header the menu opened from is gone by then.
    it('the header submenu redraw anchors to the column\'s live header', () => {
      const live = document.createElement('div');
      const menu = new DatabasePropertyMenu({ i18n: { t: (key: string) => key, getLocale: () => 'en' } as never, hasPeople: false, ...callbacks(), liveAnchor: () => live });

      menu.open(prop('number'), document.createElement('button'));
      headerTile('bar').click();

      expect(captured.popovers[captured.popovers.length - 1]?.params.trigger).toBe(live);
      menu.destroy();
    });

    // The entrance scales the menu: a submenu placed during it lands off its row.
    it('the header menu redraws in place, with no entrance', () => {
      const { menu } = headerMenu(prop('number'));

      headerTile('bar').click();

      expect(captured.popovers[0]?.transitionAtShow).toBe('');
      expect(captured.popovers[1]?.transitionAtShow).toBe('none');
      menu.destroy();
    });

    const pick = (row: string, choice: string): void => {
      const items = byName(byName(lastItems(), 'editProperty').children?.items ?? [], row).children?.items ?? [];

      byName(items, choice).onActivate?.(byName(items, choice));
    };

    // notion-spec-2 §8: picking a format closes only the format list; Edit property stays open with the new value.
    it('picking a format in the header submenu keeps Edit property open and shows the new format', () => {
      const { cb, menu, onClose } = headerMenu(prop('number'));
      const format = byName(byName(lastItems(), 'editProperty').children?.items ?? [], 'numberFormat');

      expect(format.children?.items.every((i) => i.closeOnActivate !== true)).toBe(true);
      pick('numberFormat', 'format-percent');

      expect(cb.onUpdate).toHaveBeenCalledWith('p', { number: { format: 'percent' } });
      expect(onClose).not.toHaveBeenCalled();
      expect(menu.isOpen).toBe(true);
      expect(captured.popovers[captured.popovers.length - 1]?.activated).toEqual(['editProperty']);
      expect(byName(byName(lastItems(), 'editProperty').children?.items ?? [], 'numberFormat').valueLabel).toBe('tools.database.numberFormat.percent');
      menu.destroy();
    });

    it('picking decimal places or a color keeps Edit property open and shows the new value', () => {
      const { menu, onClose } = headerMenu(prop('number', { number: { showAs: 'bar' } }));

      pick('decimals', 'decimals-2');
      expect(byName(byName(lastItems(), 'editProperty').children?.items ?? [], 'decimals').valueLabel).toBe('2');
      pick('color', 'color-red');
      expect(byName(byName(lastItems(), 'editProperty').children?.items ?? [], 'color').valueLabel).toBe('tools.colorPicker.color.red');
      expect(onClose).not.toHaveBeenCalled();
      expect(menu.isOpen).toBe(true);
      menu.destroy();
    });

    // Divide by saves on blur without a redraw, so a later pick must not write the old value back.
    it('a color picked after typing Divide by keeps the typed Divide by and still redraws', () => {
      const { cb, menu } = headerMenu(prop('number', { number: { showAs: 'bar', divideBy: 100 } }));
      const input = byName(byName(lastItems(), 'editProperty').children?.items ?? [], 'divideBy').element?.querySelector('input');

      if (input === null || input === undefined) throw new Error('no divide by input');
      input.value = '50';
      input.dispatchEvent(new Event('change'));
      const drawn = captured.popovers.length;

      pick('color', 'color-red');

      expect(cb.onUpdate).toHaveBeenLastCalledWith('p', { number: { showAs: 'bar', divideBy: 50, color: 'red' } });
      expect(captured.popovers.length).toBe(drawn + 1);
      menu.destroy();
    });

    const showNumberSwitch = (): HTMLElement => {
      const row = byName(byName(lastItems(), 'editProperty').children?.items ?? [], 'showNumber').element;
      const found = row?.matches('[role="switch"]') === true ? row : row?.querySelector<HTMLElement>('[role="switch"]');

      if (found === null || found === undefined) throw new Error('no Show number switch');

      return found;
    };

    // notion-spec-2 §2, §10: Color, Divide by, Show number.
    it('offers Show number, on, as the gauge box\'s last row, only for a bar or ring', () => {
      const { menu } = headerMenu(prop('number', { number: { showAs: 'ring' } }));
      const names = editNames();
      const toggle = showNumberSwitch();

      expect(names.indexOf('showNumber')).toBe(names.indexOf('divideBy') + 1);
      expect(toggle.getAttribute('aria-checked')).toBe('true');
      expect(toggle.textContent).toBe('tools.database.showNumber');
      expect(toggle.querySelector(':scope > [data-blok-database-switch-track]')).not.toBeNull();
      menu.destroy();
      expect(editItems(prop('number')).map((i) => i.name)).not.toContain('showNumber');
    });

    it('turning Show number off saves showNumber false; on again drops the key', () => {
      const { cb, menu } = headerMenu(prop('number', { number: { showAs: 'bar', color: 'green' } }));
      const drawn = captured.popovers.length;

      showNumberSwitch().click();
      expect(cb.onUpdate).toHaveBeenLastCalledWith('p', { number: { showAs: 'bar', color: 'green', showNumber: false } });
      expect(showNumberSwitch().getAttribute('aria-checked')).toBe('false');
      // Like Divide by, the switch saves without a redraw: the menu stays where it is.
      expect(captured.popovers.length).toBe(drawn);

      showNumberSwitch().click();
      expect(cb.onUpdate).toHaveBeenLastCalledWith('p', { number: { showAs: 'bar', color: 'green' } });
      expect(showNumberSwitch().getAttribute('aria-checked')).toBe('true');
      menu.destroy();
    });

    it('draws Show number off when the saved display has it off', () => {
      const { menu } = headerMenu(prop('number', { number: { showAs: 'bar', showNumber: false } }));

      expect(showNumberSwitch().getAttribute('aria-checked')).toBe('false');
      menu.destroy();
    });

    it('Show number keeps a typed Divide by, and a later colour keeps Show number off', () => {
      const { cb, menu } = headerMenu(prop('number', { number: { showAs: 'bar', divideBy: 100 } }));
      const input = byName(byName(lastItems(), 'editProperty').children?.items ?? [], 'divideBy').element?.querySelector('input');

      if (input === null || input === undefined) throw new Error('no divide by input');
      input.value = '50';
      input.dispatchEvent(new Event('change'));
      showNumberSwitch().click();
      expect(cb.onUpdate).toHaveBeenLastCalledWith('p', { number: { showAs: 'bar', divideBy: 50, showNumber: false } });

      pick('color', 'color-red');
      expect(cb.onUpdate).toHaveBeenLastCalledWith('p', { number: { showAs: 'bar', divideBy: 50, showNumber: false, color: 'red' } });
      menu.destroy();
    });

    // research/27 §7: the header's Edit property submenu is 300 wide; the all-views note no longer sets it.
    it('opens the header Edit property submenu at least 300 wide', () => {
      const { menu } = headerMenu(prop('number'));

      expect(byName(lastItems(), 'editProperty').children?.minWidth).toBe('300px');
      menu.destroy();
    });

    it('picking a format on the row page panel keeps the panel open with the new format', () => {
      const cb = callbacks();
      const onClose = vi.fn();
      const menu = new DatabasePropertyMenu({ i18n: { t: (key: string) => key, getLocale: () => 'en' } as never, hasPeople: false, ...cb, onClose });

      menu.openRowPage(prop('number'), document.createElement('div'), { edit: true });
      const rows = byName(lastItems(), 'numberFormat').children?.items ?? [];

      byName(rows, 'format-euro').onActivate?.(byName(rows, 'format-euro'));

      expect(cb.onUpdate).toHaveBeenCalledWith('p', { number: { format: 'euro' } });
      expect(onClose).not.toHaveBeenCalled();
      expect(menu.isOpen).toBe(true);
      expect(byName(lastItems(), 'numberFormat').valueLabel).toBe('tools.database.numberFormat.euro');
      menu.destroy();
    });

    // notion-spec-2 §9: Notion's Color value is a swatch of the colour, then its name; its list rows have swatches too.
    it('the Color row shows a swatch of the current colour before its name', () => {
      const { menu } = headerMenu(prop('number', { number: { showAs: 'ring', color: 'green' } }));
      const color = byName(byName(lastItems(), 'editProperty').children?.items ?? [], 'color');
      const swatchOf = (item: CapturedItem | undefined): string | null | undefined => item?.valueIcon?.getAttribute('data-color');

      expect(color.valueIcon?.hasAttribute('data-blok-database-option-swatch')).toBe(true);
      expect(swatchOf(color)).toBe('green');
      expect((color.children?.items ?? []).map((item) => (item.icon as unknown as HTMLElement | undefined)?.getAttribute('data-color'))).toEqual([
        'default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red',
      ]);
      menu.destroy();
    });

    // notion-spec-2 §8, §9: after a format or decimals pick the row it came from stays highlighted; a colour pick highlights nothing.
    it('after a pick in the header submenu, the picked row keeps the highlight', () => {
      const { menu } = headerMenu(prop('number', { number: { showAs: 'bar' } }));

      pick('numberFormat', 'format-percent');
      expect(captured.popovers[captured.popovers.length - 1]?.focused).toEqual(['numberFormat']);
      pick('decimals', 'decimals-2');
      expect(captured.popovers[captured.popovers.length - 1]?.focused).toEqual(['decimals']);
      pick('color', 'color-red');
      expect(captured.popovers[captured.popovers.length - 1]?.focused).toEqual([]);
      menu.destroy();
    });

    it('after a pick on the row page panel, the picked row keeps the highlight', () => {
      const menu = new DatabasePropertyMenu({ i18n: { t: (key: string) => key, getLocale: () => 'en' } as never, hasPeople: false, ...callbacks() });

      menu.openRowPage(prop('number'), document.createElement('div'), { edit: true });
      const rows = byName(lastItems(), 'decimals').children?.items ?? [];

      byName(rows, 'decimals-1').onActivate?.(byName(rows, 'decimals-1'));

      expect(captured.popovers[captured.popovers.length - 1]?.focused).toEqual(['decimals']);
      menu.destroy();
    });

    it('a color picked after Bar then Ring keeps Ring', () => {
      const { cb, menu } = headerMenu(prop('number'));

      headerTile('bar').click();
      headerTile('ring').click();
      const colors = byName(byName(lastItems(), 'editProperty').children?.items ?? [], 'color').children?.items ?? [];

      byName(colors, 'color-red').onActivate?.(byName(colors, 'color-red'));
      expect(cb.onUpdate).toHaveBeenLastCalledWith('p', { number: { showAs: 'ring', color: 'red' } });
      menu.destroy();
    });
  });

  describe('Edit property: Notion\'s note under the settings', () => {
    it.each<PropertyType>(['number', 'select', 'multiSelect', 'status'])('%s ends with "Changes apply to all views"', (type) => {
      open(prop(type, type === 'status' ? { status: createDefaultStatusSettings() } : {}));
      const items = byName(lastItems(), 'editProperty').children?.items ?? [];

      expect(items[items.length - 1]?.element?.textContent).toBe('tools.database.changesApplyToAllViews');
    });
  });

  describe('Edit property for select, multi-select and status: the options list', () => {
    const options = [
      { id: 'o1', label: 'Idea', color: 'yellow', position: 'a0' },
      { id: 'o2', label: 'Build', color: 'blue', position: 'a1' },
    ];

    it('shows the options and sends an edit out whole', () => {
      const cb = open(prop('select', { config: { options } }));
      const list = byName(byName(lastItems(), 'editProperty').children?.items ?? [], 'options').element;

      expect([...(list?.querySelectorAll('[data-blok-database-select-option]') ?? [])].map((row) => row.textContent?.trim())).toEqual(['Idea', 'Build']);
      list?.querySelector<HTMLElement>('[data-blok-database-select-option="o2"] [data-blok-database-select-option-menu]')?.click();
      list?.querySelector<HTMLElement>('[data-blok-database-option-color="red"]')?.click();

      expect(cb.onOptionsChange).toHaveBeenCalledWith('p', [options[0], { ...options[1], color: 'red' }]);
    });

    it('a status option\'s "Set as default" saves the default with the status settings (research/30 §10f)', () => {
      const status = { ...createDefaultStatusSettings(), showAs: 'checkbox' as const };
      const statusOptions = [
        { id: 'n', label: 'Not started', position: 'a0', groupId: 'todo' },
        { id: 'i', label: 'In progress', color: 'blue', position: 'a0', groupId: 'inProgress' },
      ];
      const cb = open(prop('status', { status, config: { options: statusOptions } }));
      const list = byName(byName(lastItems(), 'editProperty').children?.items ?? [], 'options').element;

      list?.querySelector<HTMLElement>('[data-blok-database-select-option="i"] [data-blok-database-select-option-menu]')?.click();
      list?.querySelector<HTMLElement>('[data-blok-database-option-set-default]')?.click();

      expect(cb.onUpdate).toHaveBeenCalledWith('p', { status: { ...status, defaultOptionId: 'i' } });
    });

    it('keeps its keys away from the menu', () => {
      open(prop('select', { config: { options } }));
      const list = byName(byName(lastItems(), 'editProperty').children?.items ?? [], 'options').element;

      expect(list?.hasAttribute('data-blok-keyboard-owner')).toBe(true);
    });
  });

  describe('Edit property for a date', () => {
    it('sets the date format, time format and time zone', () => {
      const cb = open(prop('date', { date: { timeFormat: '24_hour' } }));
      const items = byName(lastItems(), 'editProperty').children?.items ?? [];
      const formats = byName(items, 'dateFormat').children?.items ?? [];

      expect(formats.map((f) => f.name)).toEqual([
        'dateFormat-full', 'dateFormat-short', 'dateFormat-month_day_year', 'dateFormat-day_month_year', 'dateFormat-year_month_day', 'dateFormat-relative',
      ]);
      byName(formats, 'dateFormat-relative').onActivate?.(byName(formats, 'dateFormat-relative'));
      expect(cb.onUpdate).toHaveBeenCalledWith('p', { date: { timeFormat: '24_hour', dateFormat: 'relative' } });

      const zones = byName(items, 'timeZone').children?.items ?? [];

      byName(zones, 'timeZone-Asia/Tokyo').onActivate?.(byName(zones, 'timeZone-Asia/Tokyo'));
      expect(cb.onUpdate).toHaveBeenLastCalledWith('p', { date: { timeFormat: '24_hour', timeZone: 'Asia/Tokyo' } });
    });

    // research/37 §2: an untouched Date property shows "Full date" and "12 hour".
    it('shows the current date format and time format as the rows\' values', () => {
      open(prop('date'));
      const untouched = byName(lastItems(), 'editProperty').children?.items ?? [];

      expect(byName(untouched, 'dateFormat').valueLabel).toBe('tools.database.dateFormat.full');
      expect(byName(untouched, 'timeFormat').valueLabel).toBe('tools.database.timeFormat.12_hour');

      open(prop('date', { date: { dateFormat: 'relative', timeFormat: 'hidden' } }));
      const saved = byName(lastItems(), 'editProperty').children?.items ?? [];

      expect(byName(saved, 'dateFormat').valueLabel).toBe('tools.database.dateFormat.relative');
      expect(byName(saved, 'timeFormat').valueLabel).toBe('tools.database.timeFormat.hidden');
    });

    // The value reaches innerHTML, and a missing i18n key comes back as the key itself.
    it('shows the defaults for a saved format it does not know', () => {
      const markup = '<img src=x onerror=alert(1)>';

      open(prop('date', { date: { dateFormat: markup, timeFormat: markup } as never }));
      const items = byName(lastItems(), 'editProperty').children?.items ?? [];

      expect(byName(items, 'dateFormat').valueLabel).toBe('tools.database.dateFormat.full');
      expect(byName(items, 'timeFormat').valueLabel).toBe('tools.database.timeFormat.12_hour');
    });

    it('shows 24 hour on an untouched Date property when the locale uses a 24 hour clock', () => {
      const menu = new DatabasePropertyMenu({ i18n: { t: (key: string) => key, getLocale: () => 'de' } as never, hasPeople: false, ...callbacks() });

      menu.open(prop('date'), document.createElement('button'));
      const items = byName(lastItems(), 'editProperty').children?.items ?? [];

      expect(byName(items, 'timeFormat').valueLabel).toBe('tools.database.timeFormat.24_hour');
    });

    // research/17 §1d: Notifications, the Remind a new date starts with.
    it('sets Notifications from the date-only reminders, None by default', () => {
      const cb = open(prop('date', { date: { timeFormat: '24_hour' } }));
      const items = byName(lastItems(), 'editProperty').children?.items ?? [];
      const notifications = byName(items, 'dateNotifications');
      const choices = notifications.children?.items ?? [];

      expect(items.map((item) => item.name).at(-1)).toBe('dateNotifications');
      expect(notifications.title).toBe('tools.database.dateNotifications');
      expect(notifications.valueLabel).toBe('tools.database.dateRemind.none');
      expect(choices.map((c) => c.name)).toEqual([
        'dateNotifications-none', 'dateNotifications-on_day_of_event', 'dateNotifications-1_day_before',
        'dateNotifications-2_days_before', 'dateNotifications-1_week_before',
      ]);
      expect(choices.map((c) => c.isActive)).toEqual([true, false, false, false, false]);
      byName(choices, 'dateNotifications-1_week_before').onActivate?.(byName(choices, 'dateNotifications-1_week_before'));
      expect(cb.onUpdate).toHaveBeenLastCalledWith('p', { date: { timeFormat: '24_hour', defaultReminder: '1_week_before' } });
    });

    it('shows the chosen default without its time, and None removes it', () => {
      const cb = open(prop('date', { date: { defaultReminder: '1_week_before' } }));
      const notifications = byName(byName(lastItems(), 'editProperty').children?.items ?? [], 'dateNotifications');
      const choices = notifications.children?.items ?? [];

      expect(notifications.valueLabel).toBe('tools.database.dateRemind.1_week_before');
      byName(choices, 'dateNotifications-none').onActivate?.(byName(choices, 'dateNotifications-none'));
      expect(cb.onUpdate).toHaveBeenLastCalledWith('p', { date: {} });
    });
  });

  it('sets the ID prefix', () => {
    const cb = open(prop('uniqueId'));
    const field = byName(byName(lastItems(), 'editProperty').children?.items ?? [], 'prefix').element?.querySelector('input');

    if (field === null || field === undefined) throw new Error('no prefix field');
    field.value = 'TASK';
    field.dispatchEvent(new Event('change'));

    expect(cb.onUpdate).toHaveBeenCalledWith('p', { uniqueId: { prefix: 'TASK' } });
  });
});

// research/14 §3: a rename to a taken name is refused with an error; Enter does nothing; closing restores.
describe('property menu rename to a taken name', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captured.popovers.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const open = (): { cb: ReturnType<typeof callbacks>; menu: InstanceType<typeof DatabasePropertyMenu>; input: HTMLInputElement; root: HTMLElement; type: (value: string) => void } => {
    const cb = callbacks();
    const menu = new DatabasePropertyMenu({
      i18n: { t: (key: string, params?: Record<string, string>) => `${key}:${params?.name ?? ''}`, getLocale: () => 'en' } as never,
      hasPeople: false,
      ...cb,
      isNameTaken: (propertyId: string, name: string) => propertyId === 'p' && name === 'Notes',
    });

    menu.open(prop('text', { name: 'Notes 2' }), document.createElement('button'));
    const root = byName(lastItems(), 'name').element as HTMLElement;

    document.body.append(root);
    const input = root.querySelector<HTMLInputElement>('[data-blok-database-property-menu-name-input]');

    if (input === null) throw new Error('no name input');
    const type = (value: string): void => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };

    return { cb, menu, input, root, type };
  };
  const error = (root: HTMLElement): HTMLElement | null => root.querySelector<HTMLElement>('[data-blok-database-property-menu-name-error]');

  it('shows "A property named <name> already exists" under the field while the typed name is taken', () => {
    const { input, root, menu, type } = open();

    type('Notes');

    expect(error(root)?.hidden).toBe(false);
    expect(error(root)?.textContent).toBe('tools.database.propertyNameTaken:Notes');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(error(root)?.id);
    type('notes');

    expect(error(root)?.hidden).toBe(true);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    menu.destroy();
  });

  it('Enter on a taken name neither renames nor closes', () => {
    const { input, cb, menu, type } = open();

    type('Notes');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });

    input.dispatchEvent(enter);

    expect(cb.onRename).not.toHaveBeenCalled();
    expect(enter.defaultPrevented).toBe(true);
    expect(captured.popovers[captured.popovers.length - 1]?.destroyed).toBe(false);
    menu.destroy();
  });

  it('leaving the field (change) with a taken name keeps the old name', () => {
    const { input, cb, menu, type } = open();

    type('Notes');
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(cb.onRename).not.toHaveBeenCalled();
    menu.destroy();
  });

  it('a free name still renames on Enter', () => {
    const { input, cb, menu, type } = open();

    type('Memo');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    expect(cb.onRename).toHaveBeenCalledWith('p', 'Memo');
    menu.destroy();
  });
});

// feel/findings-rowpage R07, research/09:93, research/36:261: the row page's own property menu.
describe('row page property menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captured.popovers.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const rowMenu = (property: PropertyDefinition, onComment?: () => void): { cb: ReturnType<typeof callbacks>; menu: InstanceType<typeof DatabasePropertyMenu> } => {
    const cb = callbacks();
    const menu = new DatabasePropertyMenu({ i18n: { t: (key: string) => key, getLocale: () => 'en' } as never, hasPeople: false, ...cb, onCustomizeLayout: vi.fn() });

    menu.openRowPage(property, document.createElement('div'), onComment === undefined ? {} : { onComment });

    return { cb, menu };
  };
  const names = (): Array<string | undefined> => lastItems().filter((i) => i.type !== 'separator').map((i) => i.name);

  it('lists Rename, Edit property, Comment, Property visibility, Duplicate, Delete and Customize layout, with no view rows', () => {
    const { menu } = rowMenu(prop('checkbox'), vi.fn());

    expect(names()).toEqual(['rename', 'editProperty', 'comment', 'visibility', 'duplicate', 'delete', 'customize-layout']);
    expect(lastItems().every((i) => i.type === 'separator' || (i.icon ?? '') !== '')).toBe(true);
    menu.destroy();
  });

  it('groups Property visibility with Duplicate and Delete, as Notion does', () => {
    const { menu } = rowMenu(prop('checkbox'));

    expect(lastItems().map((i) => (i.type === 'separator' ? '--' : i.name))).toEqual(['rename', 'editProperty', '--', 'visibility', 'duplicate', 'delete', '--', 'customize-layout']);
    menu.destroy();
  });

  it('draws Rename and Edit property as plain actions with no submenu', () => {
    const { menu } = rowMenu(prop('number'));

    expect(byName(lastItems(), 'rename').children).toBeUndefined();
    expect(byName(lastItems(), 'editProperty').children).toBeUndefined();
    menu.destroy();
  });

  it('opens 1px under the label, in the row page look', () => {
    const { menu } = rowMenu(prop('number'));
    const params = captured.popovers[0]?.params;

    expect(params?.offset).toBe(1);
    expect(String(params?.class)).toContain('blok-database-row-page-menu');
    expect(String(params?.class)).not.toContain('blok-database-property-panel');
    menu.destroy();
  });

  // notion-spec-2 §1: only the Edit property panel takes Notion's 8px inset, so it gets its own class.
  it('marks the Edit property panel, still in the row page look', () => {
    const menu = new DatabasePropertyMenu({ i18n: { t: (key: string) => key, getLocale: () => 'en' } as never, hasPeople: false, ...callbacks() });

    menu.openRowPage(prop('number'), document.createElement('div'), { edit: true });
    const params = captured.popovers[captured.popovers.length - 1]?.params;

    expect(String(params?.class).split(' ')).toEqual(expect.arrayContaining(['blok-database-row-page-menu', 'blok-database-property-panel']));
    expect(params?.offset).toBe(1);
    menu.destroy();
  });

  it('marks the current visibility with a check on the right, in a 180px submenu, and no fill', () => {
    const { menu } = rowMenu(prop('number', { pageVisibility: 'hideWhenEmpty' }));
    const visibility = byName(lastItems(), 'visibility');
    const choices = visibility.children?.items ?? [];

    expect(visibility.children?.width).toBe('180px');
    expect(choices.map((i) => i.trailingIcon !== undefined)).toEqual([false, true, false]);
    expect(choices.every((i) => i.isActive !== true)).toBe(true);
    menu.destroy();
  });

  it.each(['rename', 'editProperty'])('%s swaps the menu for the Edit property panel with the name selected', (entry) => {
    const onClose = vi.fn();
    const cb = callbacks();
    const menu = new DatabasePropertyMenu({ i18n: { t: (key: string) => key, getLocale: () => 'en' } as never, hasPeople: false, ...cb, onClose, onCustomizeLayout: vi.fn() });

    menu.openRowPage(prop('number'), document.createElement('div'));
    const item = byName(lastItems(), entry);

    item.onActivate?.(item);

    expect(captured.popovers).toHaveLength(2);
    expect(captured.popovers[0]?.destroyed).toBe(true);
    // The host keeps the menu: a swap is no close.
    expect(onClose).not.toHaveBeenCalled();
    expect(menu.isOpen).toBe(true);
    const items = lastItems();
    const input = items[0]?.element?.querySelector<HTMLInputElement>('input');

    expect(items.map((i) => (i.type === 'separator' ? '--' : i.name))).toEqual(expect.arrayContaining(['name', 'changeType', 'duplicate', 'delete']));
    expect(items.some((i) => i.name === 'visibility' || i.name === 'customize-layout' || i.name === 'rename')).toBe(false);
    expect(captured.popovers[1]?.params.offset).toBe(1);
    expect(input).toHaveFocus();
    expect(input?.selectionStart).toBe(0);
    expect(input?.selectionEnd).toBe('Amount'.length);
    menu.destroy();
  });

  const editPanel = (property: PropertyDefinition): { cb: ReturnType<typeof callbacks>; menu: InstanceType<typeof DatabasePropertyMenu>; items: CapturedItem[] } => {
    const cb = callbacks();
    const menu = new DatabasePropertyMenu({ i18n: { t: (key: string) => key, getLocale: () => 'en' } as never, hasPeople: false, ...cb });

    menu.openRowPage(property, document.createElement('div'), { edit: true });

    return { cb, menu, items: lastItems() };
  };
  const tile = (items: CapturedItem[], value: string): HTMLElement => {
    const found = byName(items, 'showAs').element?.querySelector<HTMLElement>(`[role="radio"][data-blok-database-show-as-tile="${value}"]`);

    if (found === null || found === undefined) throw new Error(`no ${value} tile`);

    return found;
  };

  // research/10 L16 + 08-rename.png: Type and its settings in one block, a rule above Show as and above Duplicate.
  it('lays a number\'s Edit property panel out as Notion\'s', () => {
    const { menu, items } = editPanel(prop('number'));

    expect(items.map((i) => (i.type === 'separator' ? '--' : i.name))).toEqual([
      'name', 'changeType', 'numberFormat', 'decimals', '--', 'showAs', 'all-views-note', '--', 'duplicate', 'delete',
    ]);
    menu.destroy();
  });

  it('names the type row "Type", with the current type on the right', () => {
    const { menu, items } = editPanel(prop('number'));
    const type = byName(items, 'changeType');

    expect(type.title).toBe('tools.database.propertyTypeListHeading');
    expect(type.valueLabel).toBe('tools.database.propertyTypeNumber');
    expect(type.icon).toBe(IconReplace);
    menu.destroy();
  });

  it('keeps "Change type" in the table header menu', () => {
    const cb = callbacks();
    const menu = new DatabasePropertyMenu({ i18n: { t: (key: string) => key, getLocale: () => 'en' } as never, hasPeople: false, ...cb });

    menu.open(prop('number'), document.createElement('button'));
    expect(byName(lastItems(), 'changeType').title).toBe('tools.database.changeType');
    menu.destroy();
  });

  it('shows the number format and decimal places on the right of their rows', () => {
    const plain = editPanel(prop('number'));

    expect(byName(plain.items, 'numberFormat').valueLabel).toBe('tools.database.numberFormat.number');
    expect(byName(plain.items, 'decimals').valueLabel).toBe('tools.database.decimalPlacesDefault');
    plain.menu.destroy();
    const set = editPanel(prop('number', { number: { format: 'euro', decimals: 2 } }));

    expect(byName(set.items, 'numberFormat').valueLabel).toBe('tools.database.numberFormat.euro');
    expect(byName(set.items, 'decimals').valueLabel).toBe('2');
    set.menu.destroy();
  });

  it('draws Show as as three tiles, the current one checked', () => {
    const { menu, items } = editPanel(prop('number', { number: { showAs: 'bar' } }));
    const group = byName(items, 'showAs').element?.querySelector('[role="radiogroup"]');

    expect(group).toBeInstanceOf(HTMLElement);
    expect(group?.getAttribute('aria-label')).toBe('tools.database.showAs');
    expect([...(group?.querySelectorAll('[role="radio"]') ?? [])].map((r) => [r.getAttribute('data-blok-database-show-as-tile'), r.getAttribute('aria-checked')])).toEqual([
      ['number', 'false'], ['bar', 'true'], ['ring', 'false'],
    ]);
    expect(tile(items, 'number').textContent).toContain('42');
    expect(tile(items, 'bar').querySelector('[data-blok-database-number-bar]')).toBeInstanceOf(HTMLElement);
    expect(tile(items, 'ring').querySelector('[data-blok-database-number-ring]')).toBeInstanceOf(HTMLElement);
    menu.destroy();
  });

  it('a Show as tile writes the choice, keeping the other number settings', () => {
    const { cb, menu, items } = editPanel(prop('number', { number: { format: 'euro', showAs: 'bar' } }));

    tile(items, 'ring').click();
    expect(cb.onUpdate).toHaveBeenLastCalledWith('p', { number: { format: 'euro', showAs: 'ring' } });
    tile(items, 'number').click();
    expect(cb.onUpdate).toHaveBeenLastCalledWith('p', { number: { format: 'euro' } });
    menu.destroy();
  });

  it('picking Bar in the row page panel brings in Color and Divide by at once', () => {
    const { menu, items } = editPanel(prop('number'));

    tile(items, 'bar').click();
    const now = lastItems().map((i) => i.name);

    expect(now).toEqual(expect.arrayContaining(['color', 'divideBy']));
    expect(tile(lastItems(), 'bar').getAttribute('aria-checked')).toBe('true');
    expect(menu.isOpen).toBe(true);
    menu.destroy();
  });

  it('the row page panel redraws in place, with no entrance', () => {
    const { menu, items } = editPanel(prop('number'));

    tile(items, 'bar').click();

    expect(captured.popovers[0]?.transitionAtShow).toBe('');
    expect(captured.popovers[1]?.transitionAtShow).toBe('none');
    menu.destroy();
  });

  it('a color picked in the row page panel after Bar then Ring keeps Ring', () => {
    const { cb, menu, items } = editPanel(prop('number'));

    tile(items, 'bar').click();
    tile(lastItems(), 'ring').click();
    const colors = byName(lastItems(), 'color').children?.items ?? [];

    byName(colors, 'color-red').onActivate?.(byName(colors, 'color-red'));
    expect(cb.onUpdate).toHaveBeenLastCalledWith('p', { number: { showAs: 'ring', color: 'red' } });
    menu.destroy();
  });

  it('picking Bar saves a name typed but not yet saved, and keeps it in the field', () => {
    const { cb, menu, items } = editPanel(prop('number'));
    const input = items[0]?.element?.querySelector('input');

    if (input === null || input === undefined) throw new Error('no name input');
    input.value = 'Memo';
    tile(items, 'bar').click();

    expect(cb.onRename).toHaveBeenCalledWith('p', 'Memo');
    expect(lastItems()[0]?.element?.querySelector('input')?.value).toBe('Memo');
    menu.destroy();
  });

  it('the Edit property panel renames on Enter and holds the type settings inline', () => {
    const { cb, menu } = rowMenu(prop('number'));
    const rename = byName(lastItems(), 'rename');

    rename.onActivate?.(rename);
    const items = lastItems();
    const input = items[0]?.element?.querySelector<HTMLInputElement>('input');

    if (input === null || input === undefined) throw new Error('no name input');
    expect(items.findIndex((i) => i.name === 'changeType')).toBeLessThan(items.findIndex((i) => i.name === 'duplicate'));
    expect(items.length).toBeGreaterThan(6);
    input.value = 'Memo';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    expect(cb.onRename).toHaveBeenCalledWith('p', 'Memo');
    menu.destroy();
  });

  it('has no Comment without a comment lever, and no Duplicate on a relation', () => {
    const { menu } = rowMenu(prop('relation'));

    expect(names()).toEqual(['rename', 'editProperty', 'visibility', 'delete', 'customize-layout']);
    menu.destroy();
  });

  it('Comment calls the lever', () => {
    const onComment = vi.fn();
    const { menu } = rowMenu(prop('text'), onComment);

    byName(lastItems(), 'comment').onActivate?.(byName(lastItems(), 'comment'));

    expect(onComment).toHaveBeenCalledTimes(1);
    menu.destroy();
  });
});
