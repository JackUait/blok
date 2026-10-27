import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { PropertyDefinition, PropertyType } from '../../../../src/tools/database/types';
import { createDefaultStatusSettings } from '../../../../src/tools/database/property-values';
import { propertyTypeMeta } from '../../../../src/tools/database/database-property-types';
import { HINT_DELAY, destroy as destroyTooltip } from '../../../../src/components/utils/tooltip';

interface CapturedItem {
  name?: string;
  title?: string;
  titleEl?: HTMLElement;
  icon?: string;
  valueLabel?: string;
  type?: string;
  isActive?: boolean | (() => boolean);
  element?: HTMLElement;
  onActivate?: (item: CapturedItem) => void;
  children?: { items: CapturedItem[]; searchable?: boolean; searchPlaceholder?: string; width?: string; placement?: string; clickOnly?: boolean; onOpen?: () => void };
}

const captured = vi.hoisted((): { popovers: Array<{ items: CapturedItem[]; element: HTMLElement }> } => ({ popovers: [] }));

/** Draws each named row with its title element inside, as the real popover does. */
const drawRows = (items: CapturedItem[], into: HTMLElement): void => {
  for (const item of items) {
    if (item.type === 'html' && item.element !== undefined) into.appendChild(item.element);
    if (item.type !== undefined || item.name === undefined) continue;
    const row = into.appendChild(document.createElement('div'));

    row.setAttribute('data-blok-item-name', item.name);
    if (item.titleEl !== undefined) row.appendChild(document.createElement('div')).appendChild(item.titleEl);
  }
};

vi.mock('../../../../src/components/utils/popover', () => ({
  PopoverDesktop: class {
    readonly element = document.createElement('div');

    constructor(params: { items: CapturedItem[] }) {
      captured.popovers.push({ items: params.items, element: this.element });
    }

    getElement(): HTMLElement {
      return this.element;
    }

    show(): void {
      drawRows(captured.popovers.find((p) => p.element === this.element)?.items ?? [], this.element);
      document.body.appendChild(this.element);
    }

    on(): void {}

    activateItemByName(): void {}

    focusItemByName(): boolean {
      return true;
    }

    closeSubmenuOnEscape(): boolean {
      return false;
    }

    hide(): void {}

    destroy(): void {}
  },
}));

const { DatabasePropertyMenu } = await import('../../../../src/tools/database/database-property-menu');

const prop = (type: PropertyType, extra: Partial<PropertyDefinition> = {}): PropertyDefinition => ({ id: 'p', name: 'Amount', type, position: 'a1', ...extra });

const hints: Record<string, string> = {
  'tools.database.relationRelatedToHint': 'The related database cannot be changed after creation',
  'tools.database.relationTwoWayHint': 'When a page is related to another page in this database, show each direction of the relation in its own property',
  'tools.database.rollupShowUniqueHint': 'Shows the unique values for this property.',
};
const i18n = { t: (key: string) => hints[key] ?? key, getLocale: () => 'en' } as never;

const schema: PropertyDefinition[] = [
  prop('relation', { id: 'rel', name: 'Tasks', relation: { targetDatabaseId: 'db-tasks' } }),
];
const taskSchema: PropertyDefinition[] = [
  prop('number', { id: 'hours', name: 'Hours' }),
  prop('text', { id: 'notes', name: 'Notes' }),
];
const computed = () => ({
  schema: () => schema,
  databases: () => [{ id: 'db', title: 'Projects' }, { id: 'db-tasks', title: 'Tasks' }],
  targetSchema: (databaseId: string) => (databaseId === 'db-tasks' ? taskSchema : []),
  onEditFormula: vi.fn(),
  onSetTwoWay: vi.fn(),
  databaseId: 'db',
});

const callbacks = () => ({ onRename: vi.fn(), onUpdate: vi.fn(), onChangeType: vi.fn(), onDuplicate: vi.fn(), onDelete: vi.fn() });

const lastItems = (): CapturedItem[] => captured.popovers[captured.popovers.length - 1]?.items ?? [];
const byName = (items: CapturedItem[], name: string): CapturedItem => {
  const item = items.find((i) => i.name === name);

  if (item === undefined) throw new Error(`no item ${name} in ${items.map((i) => i.name).join(',')}`);

  return item;
};

/** The header menu's Edit property rows. */
const header = (property: PropertyDefinition, extras = computed()): CapturedItem[] => {
  new DatabasePropertyMenu({ ...callbacks(), i18n, hasPeople: true, computed: extras }).open(property, document.createElement('button'));

  return byName(lastItems(), 'editProperty').children?.items ?? [];
};

/** The row page's Edit property panel. */
const panel = (property: PropertyDefinition, extras = computed()): CapturedItem[] => {
  new DatabasePropertyMenu({ ...callbacks(), i18n, hasPeople: true, computed: extras }).openRowPage(property, document.createElement('div'), { edit: true });

  return lastItems();
};

const names = (items: CapturedItem[]): Array<string | undefined> => items.map((item) => item.name);
const checked = (items: CapturedItem[]): Array<string | undefined> => items.filter((item) => item.isActive === true).map((item) => item.name);

const relation = prop('relation', { relation: { targetDatabaseId: 'db-tasks' } });

beforeEach(() => {
  vi.clearAllMocks();
  captured.popovers.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

// notion-spec-2 §17: a row with a value and › opens its list on a click only, under the row, 250 wide.
describe('Edit property rows with a value open on a click only, under the row', () => {
  it.each<[string, PropertyDefinition, string]>([
    ['relation Limit', relation, 'limit'],
    ['date Date format', prop('date'), 'dateFormat'],
    ['date Time format', prop('date'), 'timeFormat'],
    ['date Notifications', prop('date'), 'dateNotifications'],
    ['created time Date format', prop('createdTime'), 'dateFormat'],
    ['created time Time format', prop('createdTime'), 'timeFormat'],
    ['last edited time Date format', prop('lastEditedTime'), 'dateFormat'],
    ['last edited time Time format', prop('lastEditedTime'), 'timeFormat'],
    ['person Limit', prop('person'), 'limit'],
    ['person Default', prop('person'), 'personDefault'],
    ['person Notifications', prop('person'), 'personNotifications'],
  ])('%s, in the header menu and in the panel', (_label, property, name) => {
    const expected = { clickOnly: true, placement: 'under', width: '250px' };

    expect(byName(header(property), name).children).toMatchObject(expected);
    expect(byName(panel(property), name).children).toMatchObject(expected);
  });

  it('status Display as, in the header menu and in the panel', () => {
    const status = prop('status', { status: createDefaultStatusSettings() });
    const expected = { clickOnly: true, placement: 'under', width: '250px' };

    new DatabasePropertyMenu({ ...callbacks(), i18n, hasPeople: false }).open(status, document.createElement('button'));
    expect(byName(lastItems(), 'displayAs').children).toMatchObject(expected);
    expect(byName(panel(status), 'displayAs').children).toMatchObject(expected);
  });
});

describe('relation Limit (§17.1)', () => {
  it('shows its value and lists 1 page, then No limit', () => {
    const row = byName(header(relation), 'limit');

    expect(row.valueLabel).toBe('tools.database.relationLimitNone');
    expect(names(row.children?.items ?? [])).toEqual(['limit-one', 'limit-none']);
    expect(checked(row.children?.items ?? [])).toEqual(['limit-none']);
  });
});

describe('status Display as (§17.3)', () => {
  const status = prop('status', { status: createDefaultStatusSettings() });

  it('shows its value and lists Checkbox, then Select, with their type icons', () => {
    new DatabasePropertyMenu({ ...callbacks(), i18n, hasPeople: false }).open(status, document.createElement('button'));
    const row = byName(lastItems(), 'displayAs');
    const items = row.children?.items ?? [];

    expect(row.valueLabel).toBe('tools.database.statusDisplayAs.select');
    expect(items.map((item) => [item.name, item.icon])).toEqual([
      ['displayAs-checkbox', propertyTypeMeta('checkbox').icon],
      ['displayAs-select', propertyTypeMeta('select').icon],
    ]);
    expect(checked(items)).toEqual(['displayAs-select']);
  });

  it('sits after the groups in the panel, before Duplicate', () => {
    const rows = names(panel(status));

    expect(rows.indexOf('displayAs')).toBe(rows.indexOf('options') + 1);
  });
});

describe('date Time format (§17.4)', () => {
  it('checks the format its value shows when none is saved', () => {
    const row = byName(header(prop('date')), 'timeFormat');
    const shown = row.valueLabel?.replace('tools.database.timeFormat.', '');

    expect(checked(row.children?.items ?? [])).toEqual([`timeFormat-${shown}`]);
  });
});

describe('rollup Relation and Target property (§17.2)', () => {
  const rollup = prop('rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'hours', function: 'show_original' } });

  it.each(['rollupRelation', 'rollupProperty'])('%s opens a 280 list on a click only, under its row, with no checkmark', (name) => {
    for (const items of [header(rollup), panel(rollup)]) {
      const row = byName(items, name);

      expect(row.children).toMatchObject({ clickOnly: true, placement: 'under', width: '280px' });
      expect(checked(row.children?.items ?? [])).toEqual([]);
    }
  });

  it('Target property has a "Search for a property…" field', () => {
    expect(byName(header(rollup), 'rollupProperty').children).toMatchObject({ searchable: true, searchPlaceholder: 'tools.database.settingsSearchProperty' });
  });

  it('a new rollup reads Select on Relation and Target property', () => {
    const items = header(prop('rollup'));

    expect(byName(items, 'rollupRelation').valueLabel).toBe('tools.database.rollupSelect');
    expect(byName(items, 'rollupProperty').valueLabel).toBe('tools.database.rollupSelect');
  });
});

describe('relation Related to and Add related property (§17.1)', () => {
  const tooltip = (): { text: string; placement: string | null } | null => {
    const wrapper = document.querySelector<HTMLElement>('[data-blok-testid="tooltip"]');

    return wrapper?.getAttribute('data-blok-shown') === 'true'
      ? { text: document.querySelector('[data-blok-testid="tooltip-content"]')?.textContent ?? '', placement: wrapper.getAttribute('data-blok-placement') }
      : null;
  };
  const hover = (el: Element | null | undefined): void => {
    if (!(el instanceof HTMLElement)) throw new Error('nothing to hover');
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 300, y: 300, width: 274, height: 28 }));
    el.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(HINT_DELAY);
  };

  beforeEach(() => {
    destroyTooltip();
    vi.useFakeTimers();
  });

  afterEach(() => {
    destroyTooltip();
    vi.useRealTimers();
  });

  it('Related to is locked once a database is set: its value, no list', () => {
    const row = byName(header(relation), 'relatedTo');

    expect(row.valueLabel).toBe('Tasks');
    expect(row.children).toBeUndefined();
  });

  it('Related to reads "This database" for a relation to its own database', () => {
    expect(byName(header(prop('relation', { relation: { targetDatabaseId: 'db' } })), 'relatedTo').valueLabel).toBe('tools.database.relationThisDatabase');
  });

  it('Related to keeps its list while no database is set', () => {
    expect(names(byName(header(prop('relation')), 'relatedTo').children?.items ?? [])).toEqual(['relatedTo-db', 'relatedTo-db-tasks']);
  });

  it('Related to shows its hint above the row, 6px off, after the hover delay', async () => {
    panel(relation);
    await Promise.resolve();
    const row = document.querySelector('[data-blok-item-name="relatedTo"]');

    hover(row);

    expect(tooltip()).toEqual({ text: hints['tools.database.relationRelatedToHint'], placement: 'top' });
  });

  it('Related to\'s hint is bound when the header menu opens Edit property', async () => {
    new DatabasePropertyMenu({ ...callbacks(), i18n, hasPeople: false, computed: computed() }).open(relation, document.createElement('button'));
    const menu = captured.popovers[captured.popovers.length - 1];
    const edit = byName(menu?.items ?? [], 'editProperty');

    // As the real popover: the submenu's rows mount inside the menu.
    drawRows(edit.children?.items ?? [], menu?.element ?? document.body);
    edit.children?.onOpen?.();
    await Promise.resolve();
    hover(menu?.element.querySelector('[data-blok-item-name="relatedTo"]'));

    expect(tooltip()?.text).toBe(hints['tools.database.relationRelatedToHint']);
  });

  it('Add related property shows On or Off and opens a 250 list with an Enable switch', () => {
    const extras = computed();
    const row = byName(header(relation, extras), 'twoWay');
    const enable = byName(row.children?.items ?? [], 'twoWay-enable').element;

    expect(row.valueLabel).toBe('tools.database.settingsOff');
    expect(row.children).toMatchObject({ clickOnly: true, placement: 'under', width: '250px' });
    expect(enable?.getAttribute('role')).toBe('switch');
    expect(enable?.textContent).toBe('tools.database.relationTwoWayEnable');
    enable?.click();
    expect(extras.onSetTwoWay).toHaveBeenCalledWith('p', true);
    expect(byName(header(prop('relation', { relation: { targetDatabaseId: 'db-tasks', twoWay: true } })), 'twoWay').valueLabel).toBe('tools.database.settingsOn');
  });

  it('Add related property\'s label and ? show its hint below the label, 200 wide', () => {
    const label = byName(panel(relation), 'twoWay').titleEl;

    expect(label?.firstChild?.textContent).toBe('tools.database.relationTwoWay');
    expect(label?.querySelector('svg')).not.toBeNull();
    hover(label);

    expect(tooltip()).toEqual({ text: hints['tools.database.relationTwoWayHint'], placement: 'bottom' });
    expect(document.querySelector<HTMLElement>('[data-blok-testid="tooltip-content"] > *')?.style.maxWidth).toBe('184px');
  });

  it('the value part of Add related property shows no hint', () => {
    panel(relation);
    hover(document.querySelector('[data-blok-item-name="twoWay"]'));

    expect(tooltip()).toBeNull();
  });
});

describe('rollup Calculate: Show unique values hint (§17.8)', () => {
  beforeEach(() => {
    destroyTooltip();
    vi.useFakeTimers();
  });

  afterEach(() => {
    destroyTooltip();
    vi.useRealTimers();
  });

  it('shows to the right of the row, 6px off, once Calculate opens', async () => {
    const items = panel(prop('rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'hours', function: 'show_original' } }));
    const menu = captured.popovers[captured.popovers.length - 1];
    const calculate = byName(items, 'rollupFunction');

    drawRows(calculate.children?.items ?? [], menu?.element ?? document.body);
    calculate.children?.onOpen?.();
    await Promise.resolve();
    const row = menu?.element.querySelector<HTMLElement>('[data-blok-item-name="rollupFunction-show_unique"]');

    if (row === null || row === undefined) throw new Error('no Show unique values row');
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 300, y: 300, width: 192, height: 28 }));
    row.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(HINT_DELAY);
    const wrapper = document.querySelector<HTMLElement>('[data-blok-testid="tooltip"]');

    expect(wrapper?.getAttribute('data-blok-shown')).toBe('true');
    expect(document.querySelector('[data-blok-testid="tooltip-content"]')?.textContent).toBe(hints['tools.database.rollupShowUniqueHint']);
    expect(wrapper?.getAttribute('data-blok-placement')).toBe('right');
  });
});
