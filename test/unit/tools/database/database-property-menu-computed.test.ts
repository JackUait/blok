import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { PropertyDefinition, PropertyType } from '../../../../src/tools/database/types';
import { IconCheck, IconPencilLine } from '../../../../src/components/icons';
import type * as Tooltip from '../../../../src/components/utils/tooltip';

interface CapturedItem {
  name?: string;
  title?: string;
  valueLabel?: string;
  icon?: string;
  chevron?: boolean;
  type?: string;
  isActive?: boolean | (() => boolean);
  trailingIcon?: string;
  isDestructive?: boolean;
  element?: HTMLElement;
  onActivate?: (item: CapturedItem) => void;
  confirmation?: { onActivate: (item: CapturedItem) => void; title?: string };
  children?: { items: CapturedItem[]; searchable?: boolean; clickOnly?: boolean; placement?: string; width?: string; class?: string; onOpen?: () => void };
}

const hint = vi.hoisted(() => ({ hide: vi.fn() }));

vi.mock('../../../../src/components/utils/tooltip', async (importOriginal) => ({
  ...await importOriginal<typeof Tooltip>(),
  hide: hint.hide,
}));

const captured = vi.hoisted((): { popovers: Array<{ items: CapturedItem[]; destroyed: boolean }>; focused: string[] } => ({ popovers: [], focused: [] }));

vi.mock('../../../../src/components/utils/popover', () => ({
  PopoverDesktop: class {
    readonly record: { items: CapturedItem[]; destroyed: boolean };

    constructor(params: { items: CapturedItem[] }) {
      this.record = { items: params.items, destroyed: false };
      captured.popovers.push(this.record);
    }

    show(): void {}

    getElement(): HTMLElement {
      return document.createElement('div');
    }

    activateItemByName(): void {}

    focusItemByName(name: string): boolean {
      captured.focused.push(name);

      return true;
    }

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

/** `items` and every item of their submenus. */
const flat = (items: CapturedItem[]): CapturedItem[] => items.flatMap((item) => [item, ...flat(item.children?.items ?? [])]);
/** An item at any depth of `items`' submenus. */
const deep = (items: CapturedItem[], name: string): CapturedItem => byName(flat(items), name);

const i18n = { t: (key: string) => key, has: () => true, getLocale: () => 'en', getEnglishTranslation: (key: string) => key } as unknown as ConstructorParameters<typeof DatabasePropertyMenu>[0]['i18n'];

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'rel', name: 'Tasks', type: 'relation', position: 'a1', relation: { targetDatabaseId: 'db-tasks' } },
];
const taskSchema: PropertyDefinition[] = [
  { id: 't-title', name: 'Task', type: 'title', position: 'a0' },
  { id: 'hours', name: 'Hours', type: 'number', position: 'a1' },
  { id: 'cost', name: 'Cost', type: 'number', position: 'a2', number: { format: 'euro', showAs: 'ring' } },
  { id: 'done', name: 'Done', type: 'checkbox', position: 'a3' },
  { id: 'twice', name: 'Twice', type: 'formula', position: 'a4', formula: { expression: '1' } },
  { id: 'due', name: 'Due', type: 'date', position: 'a5' },
];

const computed = () => ({
  // A formula whose expression is "1" reads as a number; any other as text.
  valueProperty: (property: PropertyDefinition): PropertyDefinition => (property.formula?.expression === '1' ? { ...property, type: 'number' } : { ...property, type: 'text' }),
  targetValueProperty: (_databaseId: string, property: PropertyDefinition): PropertyDefinition =>
    (property.formula?.expression === '1' ? { ...property, type: 'number' } : property),
  schema: () => schema,
  databases: () => [{ id: 'db', title: 'Projects' }, { id: 'db-tasks', title: 'Tasks' }],
  targetSchema: (databaseId: string) => (databaseId === 'db-tasks' ? taskSchema : []),
  onEditFormula: vi.fn(),
  onSetTwoWay: vi.fn(),
});

const openMenu = (property: PropertyDefinition) => {
  const cb = callbacks();
  const extras = computed();
  const menu = new DatabasePropertyMenu({ ...cb, i18n, hasPeople: false, computed: extras });

  menu.open(property, document.createElement('button'));

  return { cb, extras };
};

describe('property menu — computed types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captured.popovers = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each<[PropertyType, string[]]>([
    ['relation', ['editProperty', 'changeType', 'visibility', 'delete']],
    ['rollup', ['editProperty', 'changeType', 'visibility', 'duplicate', 'delete']],
    ['formula', ['editProperty', 'changeType', 'visibility', 'duplicate', 'delete']],
  ])('%s: Edit property first; relation has no Duplicate (research/08)', (type, entries) => {
    expect(propertyMenuEntries(prop(type))).toEqual(entries);
  });

  it('formula: Edit property opens the formula editor', () => {
    const formula = prop('formula', { formula: { expression: '' } });
    const { extras } = openMenu(formula);

    byName(lastItems(), 'editProperty').onActivate?.(byName(lastItems(), 'editProperty'));

    expect(extras.onEditFormula).toHaveBeenCalledWith('p');
  });

  // notion-spec-2 §6: a number formula's Edit property has the formula row, then Number's rows and tiles.
  it('formula: a number result shows the formula row, Number format, Decimal places and the Show as tiles', () => {
    const { extras } = openMenu(prop('formula', { formula: { expression: '1' } }));
    const edit = byName(lastItems(), 'editProperty').children?.items ?? [];

    expect(edit.map((item) => item.name ?? item.type)).toEqual([
      'editFormula', 'numberFormat', 'decimals', 'separator', 'showAs', 'all-views-note',
    ]);
    byName(edit, 'editFormula').onActivate?.(byName(edit, 'editFormula'));
    expect(extras.onEditFormula).toHaveBeenCalledWith('p');
  });

  // notion-spec-2 §6: Notion names the row "Edit formula", so the submenu does not read "Edit property › Edit property".
  it('formula: the formula row reads Edit formula', () => {
    openMenu(prop('formula', { formula: { expression: '1' } }));
    const edit = byName(lastItems(), 'editProperty').children?.items ?? [];

    expect(byName(edit, 'editFormula').title).toBe('tools.database.editFormula');
  });

  // notion-spec-2 §9: Notion draws the row with pencilLine and a chevron.
  it('formula: the Edit formula row has the pencil-line glyph and a chevron', () => {
    openMenu(prop('formula', { formula: { expression: '1' } }));
    const row = byName(byName(lastItems(), 'editProperty').children?.items ?? [], 'editFormula');

    expect(row.icon).toBe(IconPencilLine);
    expect(row.chevron).toBe(true);
  });

  // notion-spec-2 §3: Notion's rollup row reads "Target property".
  it('rollup: the target row reads Target property', () => {
    openMenu(prop('rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'hours', function: 'sum' } }));
    const edit = byName(lastItems(), 'editProperty').children?.items ?? [];

    expect(byName(edit, 'rollupProperty').title).toBe('tools.database.rollupTargetProperty');
  });

  it('formula: picking the Ring tile saves it and brings in Color and Divide by', () => {
    const { cb } = openMenu(prop('formula', { formula: { expression: '1' } }));
    const edit = byName(lastItems(), 'editProperty').children?.items ?? [];

    byName(edit, 'showAs').element?.querySelector<HTMLElement>('[data-blok-database-show-as-tile="ring"]')?.click();

    expect(cb.onUpdate).toHaveBeenCalledWith('p', { number: { showAs: 'ring', color: 'green' } });
    expect((byName(lastItems(), 'editProperty').children?.items ?? []).map((item) => item.name)).toEqual(expect.arrayContaining(['color', 'divideBy']));
  });

  it('relation: picks the related database, the limit and two-way', () => {
    const relation = prop('relation', { relation: { targetDatabaseId: 'db' } });
    const { cb, extras } = openMenu(relation);
    const edit = byName(lastItems(), 'editProperty').children?.items ?? [];
    const target = byName(byName(edit, 'relatedTo').children?.items ?? [], 'relatedTo-db-tasks');
    const one = byName(byName(edit, 'limit').children?.items ?? [], 'limit-one');

    target.onActivate?.(target);
    one.onActivate?.(one);
    byName(edit, 'twoWay').onActivate?.(byName(edit, 'twoWay'));

    expect(cb.onUpdate).toHaveBeenCalledWith('p', { relation: { targetDatabaseId: 'db-tasks' } });
    expect(cb.onUpdate).toHaveBeenCalledWith('p', { relation: { targetDatabaseId: 'db', limit: 1 } });
    expect(extras.onSetTwoWay).toHaveBeenCalledWith('p', true);
  });

  it('rollup: picks the relation, the target property and the function', () => {
    const rollup = prop('rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'hours', function: 'count' } });
    const { cb } = openMenu(rollup);
    const edit = byName(lastItems(), 'editProperty').children?.items ?? [];
    const relation = byName(byName(edit, 'rollupRelation').children?.items ?? [], 'rollupRelation-rel');
    const target = byName(byName(edit, 'rollupProperty').children?.items ?? [], 'rollupProperty-hours');
    const sum = deep(byName(edit, 'rollupFunction').children?.items ?? [], 'rollupFunction-sum');

    relation.onActivate?.(relation);
    target.onActivate?.(target);
    sum.onActivate?.(sum);

    expect(cb.onUpdate).toHaveBeenCalledWith('p', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'hours', function: 'count' } });
    expect(cb.onUpdate).toHaveBeenCalledWith('p', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'hours', function: 'sum' } });
  });

  // notion-spec-2 §14.10: a new rollup takes the target's Number format, not its Show as.
  it('rollup: picking a Number target with a format saves that format on the rollup', () => {
    const { cb } = openMenu(prop('rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId: '', function: 'show_original' } }));
    const edit = byName(lastItems(), 'editProperty').children?.items ?? [];
    const cost = byName(byName(edit, 'rollupProperty').children?.items ?? [], 'rollupProperty-cost');

    cost.onActivate?.(cost);

    expect(cb.onUpdate).toHaveBeenCalledWith('p', {
      rollup: { relationPropertyId: 'rel', targetPropertyId: 'cost', function: 'show_original' },
      number: { format: 'euro' },
    });
  });

  it('rollup: picking a Number target keeps a format the rollup already has', () => {
    const { cb } = openMenu(prop('rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'hours', function: 'sum' }, number: { format: 'dollar' } }));
    const edit = byName(lastItems(), 'editProperty').children?.items ?? [];
    const cost = byName(byName(edit, 'rollupProperty').children?.items ?? [], 'rollupProperty-cost');

    cost.onActivate?.(cost);

    expect(cb.onUpdate).toHaveBeenCalledWith('p', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'cost', function: 'sum' } });
  });

  it('rollup: the inherited format joins the Show as already saved on the rollup', () => {
    const { cb } = openMenu(prop('rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'hours', function: 'sum' }, number: { showAs: 'bar', color: 'green' } }));
    const edit = byName(lastItems(), 'editProperty').children?.items ?? [];
    const cost = byName(byName(edit, 'rollupProperty').children?.items ?? [], 'rollupProperty-cost');

    cost.onActivate?.(cost);

    expect(cb.onUpdate).toHaveBeenCalledWith('p', {
      rollup: { relationPropertyId: 'rel', targetPropertyId: 'cost', function: 'sum' },
      number: { showAs: 'bar', color: 'green', format: 'euro' },
    });
  });

  it('rollup: picking the Bar tile brings in Color and Divide by at once', () => {
    const rollup = prop('rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'hours', function: 'sum' } });
    const { cb } = openMenu(rollup);
    const edit = byName(lastItems(), 'editProperty').children?.items ?? [];

    byName(edit, 'showAs').element?.querySelector<HTMLElement>('[data-blok-database-show-as-tile="bar"]')?.click();

    expect(cb.onUpdate).toHaveBeenCalledWith('p', { number: { showAs: 'bar', color: 'green' } });
    expect((byName(lastItems(), 'editProperty').children?.items ?? []).map((item) => item.name)).toEqual(expect.arrayContaining(['color', 'divideBy']));
  });

  // notion-spec-2 §3: a Sum keeps the number rows; Show as is tiles, then the all-views note.
  it('rollup: a Sum shows Number format, Decimal places and the Show as tiles', () => {
    openMenu(prop('rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'hours', function: 'sum' } }));
    const edit = byName(lastItems(), 'editProperty').children?.items ?? [];

    expect(edit.map((item) => item.name ?? item.type)).toEqual([
      'rollupRelation', 'rollupProperty', 'rollupFunction', 'numberFormat', 'decimals', 'separator', 'showAs', 'all-views-note',
    ]);
    expect(byName(edit, 'showAs').element?.querySelectorAll('[data-blok-database-show-as-tile]')).toHaveLength(3);
  });

  // notion-spec-2 §3: Count all on a title has the tiles but no number format.
  it('rollup: a count shows the Show as tiles with no Number format or Decimal places', () => {
    openMenu(prop('rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId: 't-title', function: 'count' } }));
    const edit = byName(lastItems(), 'editProperty').children?.items ?? [];

    expect(edit.map((item) => item.name ?? item.type)).toEqual([
      'rollupRelation', 'rollupProperty', 'rollupFunction', 'separator', 'showAs', 'all-views-note',
    ]);
  });

  // notion-spec-2 §14.4: Percent has the tiles but no Number format or Decimal places.
  it.each(['percent_empty', 'percent_not_empty'] as const)('rollup: %s shows the Show as tiles with no Number format or Decimal places', (fn) => {
    openMenu(prop('rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'hours', function: fn } }));
    const edit = byName(lastItems(), 'editProperty').children?.items ?? [];

    expect(edit.map((item) => item.name ?? item.type)).toEqual([
      'rollupRelation', 'rollupProperty', 'rollupFunction', 'separator', 'showAs', 'all-views-note',
    ]);
  });

  // notion-spec-2 §15.2: Checked, Unchecked and the checkbox percents have the tiles but no number format.
  it.each(['checked', 'unchecked', 'percent_checked', 'percent_unchecked'] as const)('rollup: %s of a Checkbox shows the Show as tiles with no Number format', (fn) => {
    openMenu(prop('rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'done', function: fn } }));
    const edit = byName(lastItems(), 'editProperty').children?.items ?? [];

    expect(edit.map((item) => item.name ?? item.type)).toEqual([
      'rollupRelation', 'rollupProperty', 'rollupFunction', 'separator', 'showAs', 'all-views-note',
    ]);
  });

  // notion-spec-2 §15.3: a number formula target gets a Number target's Calculate list and rows.
  it('rollup: a number formula target offers the number functions and the number rows', () => {
    openMenu(prop('rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'twice', function: 'show_original' } }));
    const edit = byName(lastItems(), 'editProperty').children?.items ?? [];

    expect(deep(byName(edit, 'rollupFunction').children?.items ?? [], 'rollupFunction-sum')).toBeDefined();
    expect(edit.map((item) => item.name ?? item.type)).toEqual([
      'rollupRelation', 'rollupProperty', 'rollupFunction', 'numberFormat', 'decimals', 'separator', 'showAs', 'all-views-note',
    ]);
  });

  // notion-spec-2 §15.3: a new Calculate puts Show as back on Number.
  it('rollup: picking another Calculate resets Show as to Number', () => {
    const { cb } = openMenu(prop('rollup', {
      rollup: { relationPropertyId: 'rel', targetPropertyId: 'hours', function: 'show_original' },
      number: { format: 'euro', showAs: 'bar', color: 'green' },
    }));
    const edit = byName(lastItems(), 'editProperty').children?.items ?? [];
    const functions = byName(edit, 'rollupFunction').children?.items ?? [];
    const sum = deep(functions, 'rollupFunction-sum');
    const same = deep(functions, 'rollupFunction-show_original');

    sum.onActivate?.(sum);
    same.onActivate?.(same);

    expect(cb.onUpdate).toHaveBeenNthCalledWith(1, 'p', {
      rollup: { relationPropertyId: 'rel', targetPropertyId: 'hours', function: 'sum' },
      number: { format: 'euro', color: 'green' },
    });
    expect(cb.onUpdate).toHaveBeenNthCalledWith(2, 'p', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'hours', function: 'show_original' } });
  });

  it('rollup: a list result has no Show as', () => {
    openMenu(prop('rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId: 't-title', function: 'show_original' } }));
    const edit = byName(lastItems(), 'editProperty').children?.items ?? [];

    expect(edit.map((item) => item.name ?? item.type)).toEqual(['rollupRelation', 'rollupProperty', 'rollupFunction']);
  });

  // notion-spec-2 §3: Show original of a Number keeps Number's rows and the Show as tiles.
  it('rollup: Show original of a Number shows Number format, Decimal places and the Show as tiles', () => {
    openMenu(prop('rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'hours', function: 'show_original' } }));
    const edit = byName(lastItems(), 'editProperty').children?.items ?? [];

    expect(edit.map((item) => item.name ?? item.type)).toEqual([
      'rollupRelation', 'rollupProperty', 'rollupFunction', 'numberFormat', 'decimals', 'separator', 'showAs', 'all-views-note',
    ]);
  });

  // notion-spec-2 §14.5: Show unique values of a Number has the same rows as Show original.
  it('rollup: Show unique values of a Number shows Number format, Decimal places and the Show as tiles', () => {
    openMenu(prop('rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'hours', function: 'show_unique' } }));
    const edit = byName(lastItems(), 'editProperty').children?.items ?? [];

    expect(edit.map((item) => item.name ?? item.type)).toEqual([
      'rollupRelation', 'rollupProperty', 'rollupFunction', 'numberFormat', 'decimals', 'separator', 'showAs', 'all-views-note',
    ]);
  });

  it('rollup: picking a Number format on Show original of a Number saves it on the rollup', () => {
    const { cb } = openMenu(prop('rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'hours', function: 'show_original' } }));
    const edit = byName(lastItems(), 'editProperty').children?.items ?? [];
    const commas = byName(byName(edit, 'numberFormat').children?.items ?? [], 'format-number_with_commas');

    commas.onActivate?.(commas);

    expect(cb.onUpdate).toHaveBeenCalledWith('p', { number: { format: 'number_with_commas' } });
  });

  // notion-spec-2 §3: Relation, Target property and Calculate show their current pick on the right.
  it('rollup: the Relation, Target property and Calculate rows show their current value', () => {
    openMenu(prop('rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'hours', function: 'sum' } }));
    const edit = byName(lastItems(), 'editProperty').children?.items ?? [];

    expect(['rollupRelation', 'rollupProperty', 'rollupFunction'].map((name) => byName(edit, name).valueLabel)).toEqual([
      'Tasks', 'Hours', 'tools.database.rollupFn.sum',
    ]);
  });

  it('rollup: offers only the functions the target property type has', () => {
    const rollup = prop('rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId: 't-title', function: 'count' } });

    openMenu(rollup);
    const edit = byName(lastItems(), 'editProperty').children?.items ?? [];
    const names = flat(byName(edit, 'rollupFunction').children?.items ?? []).map((item) => item.name);

    expect(names).not.toContain('rollupFunction-sum');
    expect(names).toContain('rollupFunction-show_original');
  });

  describe('the row page Edit property panel', () => {
    const panel = (property: PropertyDefinition): Array<string | undefined> => {
      const menu = new DatabasePropertyMenu({ ...callbacks(), i18n, hasPeople: false, computed: computed() });

      menu.openRowPage(property, document.createElement('div'), { edit: true });
      const items = lastItems().map((i) => (i.type === 'separator' ? '--' : i.name));

      menu.destroy();

      return items;
    };

    // notion-spec-2 §3: no rule between Type and the rollup's rows.
    it('lays a Sum rollup out as Notion\'s', () => {
      expect(panel(prop('rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'hours', function: 'sum' } }))).toEqual([
        'name', 'changeType', 'rollupRelation', 'rollupProperty', 'rollupFunction', 'numberFormat', 'decimals', '--', 'showAs', 'all-views-note', '--', 'duplicate', 'delete',
      ]);
    });

    // notion-spec-2 §6: Type, the formula row, Number's rows, Show as.
    it('lays a number formula out as Notion\'s', () => {
      expect(panel(prop('formula', { formula: { expression: '1' } }))).toEqual([
        'name', 'changeType', 'editFormula', 'numberFormat', 'decimals', '--', 'showAs', 'all-views-note', '--', 'duplicate', 'delete',
      ]);
    });

    // notion-spec-2 §6: the panel's formula row reads "Edit formula", also for a text formula.
    it('names a text formula\'s row Edit formula', () => {
      const menu = new DatabasePropertyMenu({ ...callbacks(), i18n, hasPeople: false, computed: computed() });

      menu.openRowPage(prop('formula', { formula: { expression: 'x' } }), document.createElement('div'), { edit: true });
      const row = byName(lastItems(), 'editFormula');

      menu.destroy();
      expect(row.title).toBe('tools.database.editFormula');
    });
  });
});

describe('property menu — rollup picks redraw the open panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captured.popovers = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const empty = prop('rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId: '', function: 'show_original' } });

  it('row page panel: a new target shows at once, and a Calculate picked next keeps it', () => {
    const cb = callbacks();
    const menu = new DatabasePropertyMenu({ ...cb, i18n, hasPeople: false, computed: computed() });

    menu.openRowPage(empty, document.createElement('div'), { edit: true });
    const hours = deep(lastItems(), 'rollupProperty-hours');

    hours.onActivate?.(hours);

    expect(byName(lastItems(), 'rollupProperty').valueLabel).toBe('Hours');
    expect(lastItems().map((item) => item.name)).toContain('numberFormat');

    const sum = deep(lastItems(), 'rollupFunction-sum');

    sum.onActivate?.(sum);

    expect(cb.onUpdate).toHaveBeenLastCalledWith('p', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'hours', function: 'sum' } });
    menu.destroy();
  });

  it('column header Edit property: a Calculate picked after a new target keeps the target', () => {
    const { cb } = openMenu(empty);
    const hours = deep(lastItems(), 'rollupProperty-hours');

    hours.onActivate?.(hours);

    expect(byName(byName(lastItems(), 'editProperty').children?.items ?? [], 'rollupProperty').valueLabel).toBe('Hours');

    const sum = deep(lastItems(), 'rollupFunction-sum');

    sum.onActivate?.(sum);

    expect(cb.onUpdate).toHaveBeenLastCalledWith('p', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'hours', function: 'sum' } });
  });
});

describe('property menu — click-only lists (notion-spec-2 §16.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captured.popovers = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const panel = (property: PropertyDefinition): CapturedItem[] => {
    const menu = new DatabasePropertyMenu({ ...callbacks(), i18n, hasPeople: false, computed: computed() });

    menu.openRowPage(property, document.createElement('div'), { edit: true });

    return lastItems();
  };
  const sum = prop('rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'hours', function: 'sum' } });

  it.each(['numberFormat', 'decimals', 'rollupFunction'])('%s opens on a click only, under its row', (name) => {
    expect(byName(panel(sum), name).children).toMatchObject({ clickOnly: true, placement: 'under' });
  });

  // notion-spec-2 §16.1: a click swaps the panel for the type list, so the row has no submenu.
  it('Type opens no submenu', () => {
    expect(byName(panel(sum), 'changeType').children).toBeUndefined();
  });

  it('the Number property\'s own Number format and Decimal places open on a click only', () => {
    const items = panel(prop('number'));

    expect(byName(items, 'numberFormat').children?.clickOnly).toBe(true);
    expect(byName(items, 'decimals').children?.clickOnly).toBe(true);
  });

  // Not measured: they keep opening on hover.
  it.each(['rollupRelation', 'rollupProperty'])('%s still opens on hover', (name) => {
    expect(byName(panel(sum), name).children?.clickOnly).not.toBe(true);
  });

  it('opening Decimal places hides its hint', () => {
    byName(panel(sum), 'decimals').children?.onOpen?.();

    expect(hint.hide).toHaveBeenCalled();
  });

  // notion-spec-2 §16.1: the Decimal places list is 250 wide.
  it('Decimal places is 250 wide', () => {
    expect(byName(panel(sum), 'decimals').children?.width).toBe('250px');
  });

  // notion-spec-2 §17.7: Default and 0 to 5, 250x210 in the panel's list look.
  it('Decimal places offers Default and 0 to 5 only', () => {
    const decimals = byName(panel(sum), 'decimals').children;

    expect(decimals?.items.map((item) => item.title)).toEqual(['tools.database.decimalPlacesDefault', '0', '1', '2', '3', '4', '5']);
    expect(decimals?.class).toBe('blok-database-panel-list');
  });

  it('a saved 8 still shows on the row, though the list stops at 5', () => {
    expect(byName(panel(prop('number', { number: { decimals: 8 } })), 'decimals').valueLabel).toBe('8');
  });

  // notion-spec-2 §17.10: a new rollup with no relation shows "Calculate" with no value.
  it('Calculate shows no value until a relation is picked', () => {
    expect(byName(panel(prop('rollup')), 'rollupFunction').valueLabel).toBeUndefined();
    expect(byName(panel(sum), 'rollupFunction').valueLabel).toBe('tools.database.rollupFn.sum');
  });

  it('Calculate is 200 wide', () => {
    expect(byName(panel(sum), 'rollupFunction').children?.width).toBe('200px');
  });

  // notion-spec-2 §16.1: its own look (4px inset, 28px rows), not the panel's.
  it('Calculate carries the panel list class', () => {
    expect(byName(panel(sum), 'rollupFunction').children?.class).toBe('blok-database-panel-list');
  });

  it('Number format is 192 wide, in the same look', () => {
    expect(byName(panel(sum), 'numberFormat').children).toMatchObject({ width: '192px', class: 'blok-database-panel-list' });
  });

  const calculate = (targetPropertyId: string): CapturedItem[] =>
    byName(panel(prop('rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId, function: 'sum' } })), 'rollupFunction').children?.items ?? [];
  const names = (items: CapturedItem[]): Array<string | undefined> => items.map((item) => item.name ?? item.title);
  const group = (items: CapturedItem[], title: string): CapturedItem[] => {
    const row = items.find((item) => item.title === title);

    if (row === undefined) throw new Error(`no group ${title}`);

    return row.children?.items ?? [];
  };

  it('Number target: Show original, Show unique values, then Count, Percent and More options groups', () => {
    const items = calculate('hours');

    expect(names(items)).toEqual([
      'rollupFunction-show_original', 'rollupFunction-show_unique', 'rollupFunctionGroup-calcCount', 'rollupFunctionGroup-calcPercent', 'rollupFunctionGroup-calcMoreOptions',
    ]);
    expect(names(group(items, 'tools.database.calcCount'))).toEqual([
      'rollupFunction-count', 'rollupFunction-count_values', 'rollupFunction-unique', 'rollupFunction-empty', 'rollupFunction-not_empty',
    ]);
    expect(names(group(items, 'tools.database.calcPercent'))).toEqual(['rollupFunction-percent_empty', 'rollupFunction-percent_not_empty']);
    expect(names(group(items, 'tools.database.calcMoreOptions'))).toEqual([
      'rollupFunction-sum', 'rollupFunction-average', 'rollupFunction-median', 'rollupFunction-min', 'rollupFunction-max', 'rollupFunction-range',
    ]);
  });

  it('the group rows open on hover', () => {
    const items = calculate('hours');

    for (const title of ['tools.database.calcCount', 'tools.database.calcPercent', 'tools.database.calcMoreOptions']) {
      expect(items.find((item) => item.title === title)?.children?.clickOnly).not.toBe(true);
    }
  });

  it('Checkbox target: Show original, Count and Percent only', () => {
    const items = calculate('done');

    expect(names(items)).toEqual(['rollupFunction-show_original', 'rollupFunctionGroup-calcCount', 'rollupFunctionGroup-calcPercent']);
    expect(names(group(items, 'tools.database.calcCount'))).toEqual(['rollupFunction-count', 'rollupFunction-checked', 'rollupFunction-unchecked']);
    expect(names(group(items, 'tools.database.calcPercent'))).toEqual(['rollupFunction-percent_checked', 'rollupFunction-percent_unchecked']);
  });

  // notion-spec-2 §17.8: Date › (Earliest date, Latest date, Date range) in More options' place.
  it('Date target: Count, Percent and Date groups, no More options', () => {
    const items = calculate('due');

    expect(names(items)).toEqual([
      'rollupFunction-show_original', 'rollupFunction-show_unique', 'rollupFunctionGroup-calcCount', 'rollupFunctionGroup-calcPercent', 'rollupFunctionGroup-calcDate',
    ]);
    expect(names(group(items, 'tools.database.calcCount'))).toEqual([
      'rollupFunction-count', 'rollupFunction-count_values', 'rollupFunction-unique', 'rollupFunction-empty', 'rollupFunction-not_empty',
    ]);
    expect(names(group(items, 'tools.database.calcPercent'))).toEqual(['rollupFunction-percent_empty', 'rollupFunction-percent_not_empty']);
    expect(names(group(items, 'tools.database.calcDate'))).toEqual(['rollupFunction-earliest_date', 'rollupFunction-latest_date', 'rollupFunction-date_range']);
  });

  // notion-spec-2 §17.8: every group submenu is 250 wide, in the panel's list look.
  it('group submenus are 250 wide, in the panel list look', () => {
    for (const row of calculate('hours').filter((item) => item.name?.startsWith('rollupFunctionGroup-'))) {
      expect(row.children).toMatchObject({ width: '250px', class: 'blok-database-panel-list' });
    }
  });

  // notion-spec-2 §17.10: the row holding the current calculation starts highlighted, a group row too.
  it.each([
    ['percent_empty', 'rollupFunctionGroup-calcPercent'],
    ['show_original', 'rollupFunction-show_original'],
    ['sum', 'rollupFunctionGroup-calcMoreOptions'],
  ])('Calculate on %s opens with %s highlighted', async (fn, row) => {
    const calc = byName(panel(prop('rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'hours', function: fn as 'sum' } })), 'rollupFunction');

    captured.focused = [];
    calc.children?.onOpen?.();
    await Promise.resolve();

    expect(captured.focused).toEqual([row]);
  });

  // §14.4: a group submenu opens with the current calculation highlighted.
  it('the group holding the current calculation opens with it highlighted; another group does not', async () => {
    const items = byName(panel(prop('rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'hours', function: 'percent_empty' } })), 'rollupFunction').children?.items ?? [];

    captured.focused = [];
    items.find((item) => item.name === 'rollupFunctionGroup-calcPercent')?.children?.onOpen?.();
    items.find((item) => item.name === 'rollupFunctionGroup-calcCount')?.children?.onOpen?.();
    await Promise.resolve();

    expect(captured.focused).toEqual(['rollupFunction-percent_empty']);
  });

  // §17.10: the check sits on the item inside the submenu, not on its group row.
  it('the current calculation is marked inside its group, its group row is not', () => {
    const items = calculate('hours');

    const more = group(items, 'tools.database.calcMoreOptions');

    expect(items.find((item) => item.name === 'rollupFunctionGroup-calcMoreOptions')?.trailingIcon).toBeUndefined();
    expect(more.map((item) => item.trailingIcon === IconCheck)).toEqual([true, false, false, false, false, false]);
    // A check, not a fill (CLAUDE.md: no blue selected states; Notion draws no fill).
    expect(more.every((item) => item.isActive === undefined)).toBe(true);
  });

  it('Decimal places marks the current one with a check, not a fill', () => {
    const items = byName(panel(prop('number', { number: { decimals: 2 } })), 'decimals').children?.items ?? [];

    expect(items.map((item) => item.trailingIcon === IconCheck)).toEqual([false, false, false, true, false, false, false]);
    expect(items.every((item) => item.isActive === undefined)).toBe(true);
  });

  it('Text target: no More options', () => {
    expect(names(calculate('t-title'))).toEqual([
      'rollupFunction-show_original', 'rollupFunction-show_unique', 'rollupFunctionGroup-calcCount', 'rollupFunctionGroup-calcPercent',
    ]);
  });
});
