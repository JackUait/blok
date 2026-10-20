import { describe, expect, it } from 'vitest';

import { planAiSetup } from '../../../../src/tools/database/database-ai-setup';
import type { DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

const current = {
  schema: [{ id: 'name', name: 'Name', type: 'title', position: 'a0' }] as PropertyDefinition[],
  views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }] as DatabaseViewConfig[],
};

let n = 0;
const newId = (): string => `id${++n}`;

describe('planAiSetup: the host answer to "Describe what you want to build"', () => {
  it('keeps the title property id, renames it, and adds the other properties in order', () => {
    const plan = planAiSetup(current, {
      schema: [
        { id: 'h-title', name: 'Task', type: 'title', position: 'z' },
        { id: 'due', name: 'Due', type: 'date', position: 'b' },
        { id: 'done', name: 'Done', type: 'checkbox', position: 'a' },
      ],
    }, newId);

    expect(plan?.schema.map((p) => [p.id, p.name, p.type])).toEqual([
      ['name', 'Task', 'title'],
      ['due', 'Due', 'date'],
      ['done', 'Done', 'checkbox'],
    ]);
    const positions = plan?.schema.map((p) => p.position) ?? [];

    expect([...positions].sort()).toEqual(positions);
  });

  it('keeps the existing title when the host gives none, and one title when it gives two', () => {
    const none = planAiSetup(current, { schema: [{ id: 'due', name: 'Due', type: 'date', position: 'a' }] }, newId);
    const two = planAiSetup(current, {
      schema: [
        { id: 't1', name: 'One', type: 'title', position: 'a' },
        { id: 't2', name: 'Two', type: 'title', position: 'b' },
      ],
    }, newId);

    expect(none?.schema.map((p) => p.id)).toEqual(['name', 'due']);
    expect(none?.schema[0].name).toBe('Name');
    expect(two?.schema.map((p) => p.id)).toEqual(['name']);
  });

  it('drops properties with an unknown type, no name, or an id already used', () => {
    const plan = planAiSetup(current, {
      schema: [
        { id: 'a', name: 'Spell', type: 'magic', position: 'a' } as unknown as PropertyDefinition,
        { id: 'b', name: '  ', type: 'text', position: 'b' },
        { id: 'c', name: 'Notes', type: 'text', position: 'c' },
        { id: 'c', name: 'Again', type: 'text', position: 'd' },
        { id: 'name', name: 'Clash', type: 'text', position: 'e' },
      ],
    }, newId);

    expect(plan?.schema.map((p) => p.name)).toEqual(['Name', 'Notes']);
  });

  it('views name only real properties, and an unknown view type goes', () => {
    const plan = planAiSetup(current, {
      schema: [
        { id: 'status', name: 'Status', type: 'select', position: 'a' },
        { id: 'h-title', name: 'Task', type: 'title', position: 'b' },
      ],
      views: [
        {
          id: 'board', name: 'By status', type: 'board', position: 'a0', groupBy: 'status',
          sorts: [{ propertyId: 'ghost', direction: 'asc' }, { propertyId: 'h-title', direction: 'desc' }],
          filters: [{ propertyId: 'ghost', operator: 'is', value: 'x' }],
          visibleProperties: ['status', 'ghost', 'h-title'],
        },
        { id: 'odd', name: 'Odd', type: 'spiral', position: 'a1', sorts: [], filters: [], visibleProperties: [] } as unknown as DatabaseViewConfig,
      ],
    }, newId);

    expect(plan?.views.map((v) => v.type)).toEqual(['board']);
    const [board] = plan?.views ?? [];

    expect(board.groupBy).toBe('status');
    expect(board.sorts.map((s) => s.propertyId)).toEqual(['name']);
    expect(board.filters).toEqual([]);
    // The title always shows, so a view never lists it.
    expect(board.visibleProperties).toEqual(['status']);
    expect(plan?.activeViewId).toBe(board.id);
  });

  it('a groupBy on a missing property is dropped', () => {
    const plan = planAiSetup(current, {
      schema: [{ id: 'due', name: 'Due', type: 'date', position: 'a' }],
      views: [{ id: 'b', name: 'B', type: 'board', position: 'a0', groupBy: 'ghost', sorts: [], filters: [], visibleProperties: [] }],
    }, newId);

    expect(plan?.views[0].groupBy).toBeUndefined();
  });

  it('without usable views, one table view shows every new property', () => {
    const plan = planAiSetup(current, {
      schema: [{ id: 'due', name: 'Due', type: 'date', position: 'a' }],
      views: [{ id: 'x', name: 'X', type: 'nope', position: 'a0' } as unknown as DatabaseViewConfig],
    }, newId);

    expect(plan?.views.map((v) => [v.type, v.visibleProperties])).toEqual([['table', ['due']]]);
  });

  it('an answer that is not a setup is no plan', () => {
    expect(planAiSetup(current, { schema: 'nope' } as unknown as { schema: PropertyDefinition[] }, newId)).toBeNull();
    expect(planAiSetup(current, null, newId)).toBeNull();
  });

  it('carries a non-empty title', () => {
    expect(planAiSetup(current, { schema: [], title: ' Trips ' }, newId)?.title).toBe('Trips');
    expect(planAiSetup(current, { schema: [], title: '   ' }, newId)?.title).toBeUndefined();
  });
});
