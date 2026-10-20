// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSeedDefinition } from '../../../../src/shared/database/seed-layouts';
import { DatabaseModel } from '../../../../src/tools/database/database-model';
import type { PropertyDefinition, ViewType } from '../../../../src/shared/database/types';

const mint = (name: string): string => `s-${name}`;

const shape = (schema: PropertyDefinition[]): Array<[string, string]> => schema.map((p) => [p.name, p.type]);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// research/28 §3: what each "/" Database entry creates.
describe('createSeedDefinition', () => {
  it.each<[ViewType, Array<[string, string]>, string]>([
    ['table', [['Name', 'title']], 'Table'],
    ['board', [['Name', 'title'], ['Assign', 'person'], ['Status', 'status']], 'Board view'],
    ['gallery', [['Name', 'title'], ['Created', 'createdTime'], ['Tags', 'multiSelect']], 'Gallery view'],
    ['list', [['Name', 'title'], ['Tags', 'multiSelect'], ['Created', 'createdTime']], 'List view'],
    ['feed', [['Name', 'title']], 'Feed view'],
    ['calendar', [['Name', 'title'], ['Date', 'date'], ['Tags', 'multiSelect']], 'Calendar view'],
    ['timeline', [['Name', 'title'], ['Assign', 'person'], ['Date', 'date'], ['Status', 'status']], 'Timeline view'],
    ['map', [['Name', 'title'], ['Place', 'place']], 'Map view'],
  ])('%s: the measured properties, in order, and one view of that layout', (layout, properties, viewName) => {
    const seed = createSeedDefinition(layout, mint);

    expect(shape(seed.schema)).toEqual(properties);
    expect(seed.views.map((view) => [view.type, view.name])).toEqual([[layout, viewName]]);
    expect(seed.activeViewId).toBe(seed.views[0].id);
  });

  it('board: Status is a status with Not started / In progress / Done, and the board groups by it', () => {
    const seed = createSeedDefinition('board', mint);
    const status = seed.schema.find((p) => p.type === 'status');

    expect(status?.config?.options.map((o) => [o.label, o.groupId])).toEqual([
      ['Not started', 'todo'], ['In progress', 'inProgress'], ['Done', 'complete'],
    ]);
    expect(status?.status?.groups.map((g) => g.kind)).toEqual(['todo', 'inProgress', 'complete']);
    expect(seed.views[0].groupBy).toBe(status?.id);
  });

  it('gallery, list and calendar Tags have no options', () => {
    for (const layout of ['gallery', 'list', 'calendar'] as const) {
      expect(createSeedDefinition(layout, mint).schema.find((p) => p.name === 'Tags')?.config?.options).toEqual([]);
    }
  });

  it('form: Question 1 title, Respondent, Question 2 with Option 1-3, Submission time; Form builder then Responses', () => {
    const seed = createSeedDefinition('form', mint);

    expect(shape(seed.schema)).toEqual([
      ['Question 1', 'title'], ['Respondent', 'createdBy'], ['Question 2', 'multiSelect'], ['Submission time', 'createdTime'],
    ]);
    expect(seed.schema[2].config?.options.map((o) => o.label)).toEqual(['Option 1', 'Option 2', 'Option 3']);
    expect(seed.views.map((view) => [view.type, view.name])).toEqual([['form', 'Form builder'], ['table', 'Responses']]);
    expect(seed.activeViewId).toBe(seed.views[0].id);
    // "(Respondents can select up to 1)"
    expect(seed.views[0].properties?.find((p) => p.id === seed.schema[2].id)?.maxSelections).toBe(1);
  });

  it('every id derives from the seed, so two clients write the same definition', () => {
    for (const layout of ['table', 'board', 'gallery', 'list', 'feed', 'calendar', 'timeline', 'map', 'form'] as const) {
      expect(createSeedDefinition(layout, mint)).toEqual(createSeedDefinition(layout, mint));
      const ids = [...createSeedDefinition(layout, mint).schema.map((p) => p.id), ...createSeedDefinition(layout, mint).views.map((v) => v.id)];

      expect(ids.every((id) => id.startsWith('s-'))).toBe(true);
    }
  });

  it('the editor model builds the seed for a seeded layout', () => {
    const model = new DatabaseModel(undefined, { idSeed: 's', defaultViewType: 'form' });
    const seed = createSeedDefinition('form', mint);

    expect(model.getSchema()).toEqual(seed.schema);
    expect(model.getViews()).toEqual(seed.views);
  });
});
