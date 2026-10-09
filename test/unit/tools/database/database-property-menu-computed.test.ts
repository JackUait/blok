import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { PropertyDefinition, PropertyType } from '../../../../src/tools/database/types';

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
    ['relation', ['editProperty', 'changeType', 'description', 'visibility', 'delete']],
    ['rollup', ['editProperty', 'changeType', 'description', 'visibility', 'duplicate', 'delete']],
    ['formula', ['editProperty', 'changeType', 'description', 'visibility', 'duplicate', 'delete']],
  ])('%s: Edit property first; relation has no Duplicate (research/08)', (type, entries) => {
    expect(propertyMenuEntries(prop(type))).toEqual(entries);
  });

  it('formula: Edit property opens the formula editor', () => {
    const formula = prop('formula', { formula: { expression: '' } });
    const { extras } = openMenu(formula);

    byName(lastItems(), 'editProperty').onActivate?.(byName(lastItems(), 'editProperty'));

    expect(extras.onEditFormula).toHaveBeenCalledWith('p');
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

  it('rollup: offers only the functions the target property type has', () => {
    const rollup = prop('rollup', { rollup: { relationPropertyId: 'rel', targetPropertyId: 't-title', function: 'count' } });

    openMenu(rollup);
    const edit = byName(lastItems(), 'editProperty').children?.items ?? [];
    const names = (byName(edit, 'rollupFunction').children?.items ?? []).map((item) => item.name);

    expect(names).not.toContain('rollupFunction-sum');
    expect(names).toContain('rollupFunction-show_original');
  });
});
