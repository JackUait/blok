// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../../../src/components/i18n/locales/en.json';
import { DATABASE_DEFAULT_TEXT } from '../../../../src/shared/database/default-text';
import { createDefaultSchema, createDefaultView, freePropertyName, positionBetween } from '../../../../src/shared/database/schema-ops';
import { DATABASE_DEFAULT_TEXT as EDITOR_DEFAULT_TEXT } from '../../../../src/tools/database/database-localization';
import { DatabaseModel } from '../../../../src/tools/database/database-model';

const KEYS: Record<keyof typeof DATABASE_DEFAULT_TEXT, string> = {
  titleProperty: 'tools.database.defaultTitleProperty',
  sourceTitleProperty: 'tools.database.defaultSourceTitleProperty',
  statusProperty: 'tools.database.defaultStatusProperty',
  statusNotStarted: 'tools.database.defaultStatusNotStarted',
  statusInProgress: 'tools.database.defaultStatusInProgress',
  statusDone: 'tools.database.defaultStatusDone',
  statusGroupTodo: 'tools.database.statusGroupTodo',
  statusGroupInProgress: 'tools.database.statusGroupInProgress',
  statusGroupComplete: 'tools.database.statusGroupComplete',
  viewBoard: 'tools.database.defaultViewBoard',
  viewTypeBoard: 'tools.database.viewTypeBoard',
  viewTypeList: 'tools.database.viewTypeList',
  viewTypeTable: 'tools.database.viewTypeTable',
  viewTypeGallery: 'tools.database.viewTypeGallery',
  viewTypeCalendar: 'tools.database.viewTypeCalendar',
  viewTypeTimeline: 'tools.database.viewTypeTimeline',
  viewTypeChart: 'tools.database.viewTypeChart',
  viewTypeFeed: 'tools.database.viewTypeFeed',
  viewTypeForm: 'tools.database.viewTypeForm',
  viewTypeMap: 'tools.database.viewTypeMap',
  viewMapSeed: 'toolNames.mapView',
  placeProperty: 'tools.database.propertyTypePlace',
  duplicatePropertyName: 'tools.database.duplicatePropertyName',
};

const english: Record<string, unknown> = en;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shared database building blocks', () => {
  it('default labels are the English locale strings, and the editor re-exports them', () => {
    expect(Object.fromEntries(Object.keys(KEYS).map(field => [field, english[KEYS[field as keyof typeof KEYS]]]))).toEqual({ ...DATABASE_DEFAULT_TEXT });
    expect(EDITOR_DEFAULT_TEXT).toBe(DATABASE_DEFAULT_TEXT);
  });

  it('positions sort between their neighbours and the model delegates', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const key = positionBetween('a0', 'a1');

    expect(key > 'a0' && key < 'a1').toBe(true);
    expect(DatabaseModel.positionBetween('a0', 'a1')).toBe(key);
    expect(DatabaseModel.positionBetween('a5', null)).toBe(positionBetween('a5', null));
    expect(DatabaseModel.positionBetween('a0', 'a0')).toBe(positionBetween('a0', 'a0'));
    expect(DatabaseModel.positionBetween('!x', null)).toBe(positionBetween('!x', null));
  });

  it.each(['board', 'table', 'list', 'map'] as const)('default schema and a %s view equal what the editor model builds', type => {
    const mint = (name: string): string => `s-${name}`;
    const model = new DatabaseModel(undefined, { idSeed: 's', defaultViewType: type });
    const schema = createDefaultSchema(mint, type);

    expect(schema).toEqual(model.getSchema());
    expect([createDefaultView(type, schema, mint)]).toEqual(model.getViews());
  });
});

// research/20 §1a: "/map" names its view "Map view" and adds a "Place" property.
it('a map default has a Place property with a seeded id and a "Map view" view; other layouts have none', () => {
  const mint = (name: string): string => `s-${name}`;
  const schema = createDefaultSchema(mint, 'map');

  expect(schema.filter(p => p.type === 'place')).toEqual([{ id: 's-place', name: 'Place', type: 'place', position: 'a2' }]);
  expect(createDefaultView('map', schema, mint).name).toBe('Map view');
  expect(createDefaultSchema(mint, 'table').some(p => p.type === 'place')).toBe(false);
});

// research/14 §1, §2a, §4: a taken name gets " N", the lowest free N from 1, on an exact match.
describe('freePropertyName', () => {
  it.each<[string[], string, string]>([
    [['Name'], 'Notes', 'Notes'],
    [['Name', 'Notes'], 'Notes', 'Notes 1'],
    [['Name', 'Notes', 'Notes 1'], 'Notes', 'Notes 2'],
    [['Name', 'Notes', 'Notes 2'], 'Notes', 'Notes 1'],
    [['Notes', 'Notes 1', 'Notes 2'], 'Notes', 'Notes 3'],
    [['Notes', 'Notes 1'], 'Notes 1', 'Notes 1 1'],
    [['Notes'], 'notes', 'notes'],
    [['Notes'], 'NOTES', 'NOTES'],
    [['notes'], 'notes', 'notes 1'],
    [['Notes'], 'Notes ', 'Notes '],
    [['Name'], 'name', 'name'],
  ])('%j + %j -> %j', (names, wanted, expected) => {
    expect(freePropertyName(names, wanted)).toBe(expected);
  });
});
