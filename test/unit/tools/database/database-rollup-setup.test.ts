import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { IconChevronDown } from '../../../../src/components/icons';
import { PopoverItemType } from '../../../../src/components/utils/popover/components/popover-item';
import { rollupSetupItems } from '../../../../src/tools/database/database-rollup-setup';
import type { RollupSetupHost } from '../../../../src/tools/database/database-rollup-setup';
import type { PopoverItemDefaultParams, PopoverItemHtmlParams, PopoverItemParams } from '../../../../types/utils/popover/popover-item';
import type { DatabaseData, PropertyDefinition } from '../../../../src/tools/database/types';
import { buildDatabase, makeDoc, rowSeed } from './structure-harness';

const relation: PropertyDefinition = { id: 'rel', name: 'Related', type: 'relation', position: 'a1', relation: { targetDatabaseId: 'other' } };
const rollup: PropertyDefinition = {
  id: 'ru', name: 'Rollup', type: 'rollup', position: 'a2',
  rollup: { relationPropertyId: 'rel', targetPropertyId: 'n', function: 'show_original' },
};
const targets: PropertyDefinition[] = [
  { id: 't', name: 'Name', type: 'title', position: 'a0' },
  { id: 'n', name: 'Number', type: 'number', position: 'a1', number: { format: 'percent' } },
  { id: 'c', name: 'Done', type: 'checkbox', position: 'a2' },
  { id: 'r2', name: 'Other rollup', type: 'rollup', position: 'a3' },
];

const makeHost = (overrides: Partial<RollupSetupHost> = {}): RollupSetupHost => ({
  i18n: { t: (key: string) => key },
  schema: () => [{ id: 'title', name: 'Name', type: 'title', position: 'a0' }, relation, rollup],
  targetSchema: (databaseId) => (databaseId === 'other' ? targets : []),
  update: vi.fn(),
  ...overrides,
});

const isDefault = (item: PopoverItemParams): item is PopoverItemDefaultParams =>
  item.type === undefined || item.type === PopoverItemType.Default;

const rows = (items: PopoverItemParams[]): PopoverItemDefaultParams[] => items.filter(isDefault);

const childrenOf = (item: PopoverItemDefaultParams | undefined): PopoverItemDefaultParams[] => {
  const children: PopoverItemParams[] = item !== undefined && 'children' in item ? item.children?.items ?? [] : [];

  return rows(children);
};

const flatLeaves = (items: PopoverItemDefaultParams[]): PopoverItemDefaultParams[] =>
  items.flatMap((item) => ('children' in item && item.children !== undefined ? flatLeaves(childrenOf(item)) : [item]));

describe('rollup setup menu (notion-spec-2 §20.11, §18.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows Relation, Property and Calculate as labelled dropdowns, in that order', () => {
    const items = rollupSetupItems(rollup, makeHost());
    const labels = items
      .filter((item): item is PopoverItemHtmlParams => item.type === PopoverItemType.Html)
      .map((item) => item.element.textContent);

    expect(labels).toEqual(['tools.database.rollupRelation', 'tools.database.rollupProperty', 'tools.database.rollupFunction']);
    expect(rows(items).map((row) => row.title)).toEqual(['Related', 'Number', 'tools.database.rollupFn.show_original']);
    expect(items.filter((item) => item.type === PopoverItemType.Separator)).toHaveLength(2);
  });

  it('draws a down chevron on each dropdown, and the type icon on Relation and Property only', () => {
    const [rel, prop, calc] = rows(rollupSetupItems(rollup, makeHost()));

    for (const row of [rel, prop, calc]) {
      expect(row.trailingIcon).toBe(IconChevronDown);
      expect('children' in row ? row.children?.hideChevron : undefined).toBe(true);
    }
    expect(rel.icon).toBeDefined();
    expect(prop.icon).toBeDefined();
    expect(calc.icon).toBeUndefined();
  });

  it('picking a relation writes it', () => {
    const host = makeHost();
    const [rel] = rows(rollupSetupItems(rollup, host));

    childrenOf(rel).find((item) => item.title === 'Related')?.onActivate?.(rel);

    expect(host.update).toHaveBeenCalledWith({ rollup: expect.objectContaining({ relationPropertyId: 'rel' }) });
  });

  it('never offers a rollup as the property, and a picked Number brings its format', () => {
    const host = makeHost();
    const unformatted: PropertyDefinition = { ...rollup, rollup: { relationPropertyId: 'rel', targetPropertyId: 't', function: 'show_original' } };
    const [, prop] = rows(rollupSetupItems(unformatted, host));
    const offered = childrenOf(prop);

    expect(offered.map((item) => item.title)).toEqual(['Name', 'Number', 'Done']);
    offered.find((item) => item.title === 'Number')?.onActivate?.(prop);

    expect(host.update).toHaveBeenCalledWith({
      rollup: expect.objectContaining({ targetPropertyId: 'n' }),
      number: { format: 'percent' },
    });
  });

  it('offers the calculations of the picked property, and a new one drops Show as', () => {
    const host = makeHost();
    const shown: PropertyDefinition = { ...rollup, rollup: { relationPropertyId: 'rel', targetPropertyId: 'c', function: 'show_original' }, number: { showAs: 'bar' } };
    const [, , calc] = rows(rollupSetupItems(shown, host));
    const leaves = flatLeaves(childrenOf(calc));

    expect(leaves.map((item) => item.name)).toEqual([
      'rollupFunction-show_original', 'rollupFunction-count', 'rollupFunction-checked', 'rollupFunction-unchecked',
      'rollupFunction-percent_checked', 'rollupFunction-percent_unchecked',
    ]);
    leaves.find((item) => item.name === 'rollupFunction-checked')?.onActivate?.(calc);

    expect(host.update).toHaveBeenCalledWith({ rollup: expect.objectContaining({ function: 'checked' }), number: {} });
  });

  it('marks the current calculation', () => {
    const [, , calc] = rows(rollupSetupItems(rollup, makeHost()));
    const current = flatLeaves(childrenOf(calc)).filter((item) => item.isActive === true);

    expect(current.map((item) => item.name)).toEqual(['rollupFunction-show_original']);
  });
});

describe('DatabaseTool.openRollupSetup', () => {
  const schema: PropertyDefinition[] = [
    { id: 'title', name: 'Name', type: 'title', position: 'a0' },
    { id: 'n', name: 'Number', type: 'number', position: 'a1' },
    { id: 'rel', name: 'Related', type: 'relation', position: 'a2', relation: { targetDatabaseId: 'db' } },
    { id: 'ru', name: 'Rollup', type: 'rollup', position: 'a3', rollup: { relationPropertyId: 'rel', targetPropertyId: 'n', function: 'show_original' } },
  ];
  const data = (): DatabaseData => ({
    schema: structuredClone(schema),
    views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['n', 'rel', 'ru'] }],
    activeViewId: 'v',
  });
  const menu = (): HTMLElement | null => document.querySelector('[data-blok-popover-custom-class~="blok-database-rollup-setup"]');

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('opens the menu with its three sections for a rollup', () => {
    const doc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }, rowSeed('r1', 'db', { properties: { title: 'One' } })]);
    const { tool, el } = buildDatabase(doc, 'db', data());
    const cell = el.querySelector<HTMLElement>('[data-row-id="r1"] [data-property-id="ru"]');

    if (cell === null) throw new Error('no rollup cell');
    tool.openRollupSetup({ cell, propertyId: 'ru' });
    const rows = [...(menu()?.querySelectorAll<HTMLElement>('[data-blok-database-rollup-setup-label]') ?? [])].map((node) => node.textContent);

    expect(rows).toEqual(['tools.database.rollupRelation', 'tools.database.rollupProperty', 'tools.database.rollupFunction']);
  });

  it('opens nothing for a property that is not a rollup', () => {
    const doc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }, rowSeed('r1', 'db', { properties: { title: 'One' } })]);
    const { tool, el } = buildDatabase(doc, 'db', data());
    const cell = el.querySelector<HTMLElement>('[data-row-id="r1"] [data-property-id="n"]');

    if (cell === null) throw new Error('no number cell');
    tool.openRollupSetup({ cell, propertyId: 'n' });

    expect(menu()).toBeNull();
  });
});
