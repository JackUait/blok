import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { PropertyDefinition, PropertyType } from '../../../../src/tools/database/types';
import { createDefaultStatusSettings } from '../../../../src/tools/database/property-values';

interface CapturedItem {
  name?: string;
  title?: string;
  type?: string;
  isActive?: boolean | (() => boolean);
  isDestructive?: boolean;
  element?: HTMLElement;
  onActivate?: (item: CapturedItem) => void;
  confirmation?: { onActivate: (item: CapturedItem) => void; title?: string };
  children?: { items: CapturedItem[]; searchable?: boolean };
}

const captured = vi.hoisted((): { popovers: Array<{ items: CapturedItem[]; destroyed: boolean }> } => ({ popovers: [] }));

vi.mock('../../../../src/components/utils/popover', () => ({
  PopoverDesktop: class {
    readonly record: { items: CapturedItem[]; destroyed: boolean };

    constructor(params: { items: CapturedItem[] }) {
      this.record = { items: params.items, destroyed: false };
      captured.popovers.push(this.record);
    }

    show(): void {}

    on(): void {}

    hide(): void {}

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
    ['title', ['description']],
    ['text', ['changeType', 'description', 'visibility', 'duplicate', 'delete']],
    ['number', ['editProperty', 'changeType', 'description', 'visibility', 'duplicate', 'delete']],
    ['select', ['changeType', 'description', 'visibility', 'duplicate', 'delete']],
    ['status', ['displayAs', 'changeType', 'description', 'visibility', 'duplicate', 'delete']],
    ['date', ['editProperty', 'changeType', 'description', 'visibility', 'duplicate', 'delete']],
    ['checkbox', ['changeType', 'description', 'visibility', 'duplicate', 'delete']],
    ['files', ['changeType', 'description', 'visibility', 'duplicate', 'delete']],
    ['createdTime', ['editProperty', 'changeType', 'description', 'visibility', 'duplicate', 'delete']],
    ['uniqueId', ['editProperty', 'description', 'visibility', 'delete']],
  ])('%s → %j', (type, entries) => {
    expect(propertyMenuEntries(prop(type))).toEqual(entries);
  });
});

describe('DatabasePropertyMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captured.popovers.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const open = (property: PropertyDefinition, hasPeople = false): ReturnType<typeof callbacks> => {
    const cb = callbacks();
    const menu = new DatabasePropertyMenu({ i18n: { t: (key: string) => key, getLocale: () => 'en' } as never, hasPeople, ...cb });

    menu.open(property, document.createElement('button'));

    return cb;
  };

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

  it('saves the description from its field', () => {
    const cb = open(prop('text'));
    const area = byName(lastItems(), 'description').children?.items[0]?.element?.querySelector('textarea');

    if (area === null || area === undefined) throw new Error('no description field');
    area.value = 'What we spend';
    area.dispatchEvent(new Event('change'));

    expect(cb.onUpdate).toHaveBeenCalledWith('p', { description: 'What we spend' });
  });

  it('switches a status between select and checkbox display', () => {
    const status = createDefaultStatusSettings();
    const cb = open(prop('status', { status }));
    const options = byName(lastItems(), 'displayAs').children?.items ?? [];

    byName(options, 'displayAs-checkbox').onActivate?.(byName(options, 'displayAs-checkbox'));

    expect(cb.onUpdate).toHaveBeenCalledWith('p', { status: { ...status, showAs: 'checkbox' } });
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

      const showAs = byName(items, 'showAs').children?.items ?? [];

      byName(showAs, 'showAs-ring').onActivate?.(byName(showAs, 'showAs-ring'));
      expect(cb.onUpdate).toHaveBeenLastCalledWith('p', { number: { format: 'euro', showAs: 'ring' } });
    });

    it('offers color and divide-by only for a bar or ring', () => {
      expect(editItems(prop('number')).map((i) => i.name)).not.toContain('color');
      expect(editItems(prop('number', { number: { showAs: 'bar' } })).map((i) => i.name)).toEqual(expect.arrayContaining(['color', 'divideBy']));
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
