// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../../../src/components/i18n/locales/en.json';
import { DATABASE_DEFAULT_TEXT } from '../../../../src/shared/database/default-text';
import { createDefaultSchema, createDefaultView, freePropertyName, newView } from '../../../../src/shared/database/schema-ops';
import { positionBetween } from '../../../../src/shared/database/positions';
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
  viewBoardSeed: 'toolNames.board',
  viewGallerySeed: 'toolNames.galleryView',
  viewListSeed: 'toolNames.listView',
  viewFeedSeed: 'toolNames.feedView',
  viewCalendarSeed: 'toolNames.calendarView',
  viewTimelineSeed: 'toolNames.timelineView',
  viewFormBuilder: 'tools.database.seedFormBuilder',
  viewResponses: 'tools.database.seedResponses',
  assignProperty: 'tools.database.seedAssign',
  createdProperty: 'tools.database.seedCreated',
  tagsProperty: 'tools.database.starterTags',
  dateProperty: 'tools.database.propertyTypeDate',
  questionProperty: 'tools.database.seedQuestion',
  respondentProperty: 'tools.database.seedRespondent',
  submissionTimeProperty: 'tools.database.seedSubmissionTime',
  optionLabel: 'tools.database.seedOption',
  duplicatePropertyName: 'tools.database.duplicatePropertyName',
  relationReverseName: 'tools.database.relationReverseName',
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

  it('the unseeded default schema and board view equal what the editor model builds', () => {
    const mint = (name: string): string => `s-${name}`;
    const model = new DatabaseModel(undefined, { idSeed: 's' });
    const schema = createDefaultSchema(mint);

    expect(schema).toEqual(model.getSchema());
    expect([createDefaultView('board', schema, mint)]).toEqual(model.getViews());
  });
});

// notion-spec-2 §21.8 (list-row-default.png): a new List view shows the title and Status, the rest hidden.
describe('a new list view', () => {
  const schema = [
    { id: 't', name: 'Name', type: 'title' as const, position: 'a0' },
    { id: 'x', name: 'Text', type: 'text' as const, position: 'a1' },
    { id: 's', name: 'Status', type: 'status' as const, position: 'a2' },
  ];
  const visible = (view: ReturnType<typeof newView>): string[] =>
    (view.properties ?? []).filter((p) => p.visible === true).map((p) => p.id);

  it('shows the title and the status property only', () => {
    expect(visible(newView({ id: 'v', name: 'List', type: 'list', position: 'a0' }, schema))).toEqual(['t', 's']);
  });

  it('keeps the shown list it is given', () => {
    expect(visible(newView({ id: 'v', name: 'List', type: 'list', position: 'a0', visibleProperties: ['x'] }, schema))).toEqual(['t', 'x']);
  });

  it('leaves the status hidden in a new calendar or gallery', () => {
    expect(visible(newView({ id: 'v', name: 'Calendar', type: 'calendar', position: 'a0' }, schema))).toEqual(['t']);
    expect(visible(newView({ id: 'v', name: 'Gallery', type: 'gallery', position: 'a0' }, schema))).toEqual(['t']);
  });
});

// notion-spec-2 §21.7–21.8, notion-live-3 gallery-cards-top, notion-live-4 33/62/65/69/73: a new card or list
// view lists its hidden properties by name, so "Show all" shows them A→Z after the ones already shown.
describe('the property order of a new view', () => {
  const schema = [
    { id: 't', name: 'Name', type: 'title' as const, position: 'a0' },
    { id: 'x', name: 'Text', type: 'text' as const, position: 'a1' },
    { id: 'n', name: 'Number', type: 'number' as const, position: 'a2' },
    { id: 's', name: 'Status', type: 'status' as const, position: 'a3' },
    { id: 'c', name: 'Checkbox', type: 'checkbox' as const, position: 'a4' },
  ];
  const order = (type: 'table' | 'gallery' | 'board' | 'list' | 'calendar' | 'timeline'): string[] =>
    (newView({ id: 'v', name: 'V', type, position: 'a0' }, schema).properties ?? []).map((p) => p.id);

  it.each(['gallery', 'board', 'calendar', 'timeline'] as const)('a %s lists the title, then the rest by name', (type) => {
    expect(order(type)).toEqual(['t', 'c', 'n', 's', 'x']);
  });

  it('a list puts its shown Status first, then the rest by name', () => {
    expect(order('list')).toEqual(['t', 's', 'c', 'n', 'x']);
  });

  it('a table keeps the schema order', () => {
    expect(order('table')).toEqual(['t', 'x', 'n', 's', 'c']);
  });
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
