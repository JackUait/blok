// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../../../src/components/i18n/locales/en.json';
import { DATABASE_DEFAULT_TEXT } from '../../../../src/shared/database/default-text';
import { createDefaultSchema, createDefaultView, positionBetween } from '../../../../src/shared/database/schema-ops';
import { DATABASE_DEFAULT_TEXT as EDITOR_DEFAULT_TEXT } from '../../../../src/tools/database/database-localization';
import { DatabaseModel } from '../../../../src/tools/database/database-model';

const KEYS: Record<keyof typeof DATABASE_DEFAULT_TEXT, string> = {
  titleProperty: 'tools.database.defaultTitleProperty',
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

  it.each(['board', 'table', 'list'] as const)('default schema and a %s view equal what the editor model builds', type => {
    const mint = (name: string): string => `s-${name}`;
    const model = new DatabaseModel(undefined, { idSeed: 's', defaultViewType: type });
    const schema = createDefaultSchema(mint);

    expect(schema).toEqual(model.getSchema());
    expect([createDefaultView(type, schema, mint)]).toEqual(model.getViews());
  });
});
