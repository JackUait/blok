import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { PropertyDefinition, PropertyType } from '../../../../src/tools/database/types';

interface CapturedItem {
  name?: string;
  title?: string;
  valueLabel?: string;
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

    getElement(): HTMLElement {
      return document.createElement('div');
    }

    activateItemByName(): void {}

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

const i18n = { t: (key: string) => key, has: () => true, getLocale: () => 'en', getEnglishTranslation: (key: string) => key } as unknown as ConstructorParameters<typeof DatabasePropertyMenu>[0]['i18n'];

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'rel', name: 'Tasks', type: 'relation', position: 'a1', relation: { targetDatabaseId: 'db-tasks' } },
];
const taskSchema: PropertyDefinition[] = [
  { id: 't-title', name: 'Task', type: 'title', position: 'a0' },
  { id: 'hours', name: 'Hours', type: 'number', position: 'a1' },
];

const computed = () => ({
  // A formula whose expression is "1" reads as a number; any other as text.
  valueProperty: (property: PropertyDefinition): PropertyDefinition => (property.formula?.expression === '1' ? { ...property, type: 'number' } : { ...property, type: 'text' }),
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

    expect(cb.onUpdate).toHaveBeenCalledWith('p', { number: { showAs: 'ring' } });
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
    const sum = byName(byName(edit, 'rollupFunction').children?.items ?? [], 'rollupFunction-sum');

    relation.onActivate?.(relation);
    target.onActivate?.(target);
    sum.onActivate?.(sum);

    expect(cb.onUpdate).toHaveBeenCalledWith('p', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'hours', function: 'count' } });
    expect(cb.onUpdate).toHaveBeenCalledWith('p', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'hours', function: 'sum' } });
  });

  it('rollup: picking the Bar tile brings in Color and Divide by at once', () => {
    const rollup = prop('rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId: 'hours', function: 'sum' } });
    const { cb } = openMenu(rollup);
    const edit = byName(lastItems(), 'editProperty').children?.items ?? [];

    byName(edit, 'showAs').element?.querySelector<HTMLElement>('[data-blok-database-show-as-tile="bar"]')?.click();

    expect(cb.onUpdate).toHaveBeenCalledWith('p', { number: { showAs: 'bar' } });
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

  it('rollup: a list result has no Show as', () => {
    openMenu(prop('rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId: 't-title', function: 'show_original' } }));
    const edit = byName(lastItems(), 'editProperty').children?.items ?? [];

    expect(edit.map((item) => item.name ?? item.type)).toEqual(['rollupRelation', 'rollupProperty', 'rollupFunction']);
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
    const names = (byName(edit, 'rollupFunction').children?.items ?? []).map((item) => item.name);

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
