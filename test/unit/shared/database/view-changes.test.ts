// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyViewChanges, layoutChange } from '../../../../src/shared/database/view-changes';

import type { DatabaseViewConfig, PropertyDefinition } from '../../../../src/shared/database/types';

const schema: PropertyDefinition[] = [
  { id: 't', name: 'Name', type: 'title', position: 'a0' },
  { id: 'n', name: 'Size', type: 'number', position: 'a1' },
  { id: 's', name: 'Stage', type: 'status', position: 'a2' },
];

const table = (): DatabaseViewConfig => ({ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] });

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('applyViewChanges', () => {
  it('removes a key given as undefined or null, so a JSON copy cannot keep it', () => {
    const view = { ...table(), groupBy: 's', cardSize: 'large' as const };

    applyViewChanges(view, { groupBy: undefined, cardSize: null }, schema);

    expect(Object.keys(view)).not.toContain('groupBy');
    expect(Object.keys(view)).not.toContain('cardSize');
  });

  it('keeps visibleProperties in step with properties for older readers', () => {
    const view = table();

    applyViewChanges(view, { properties: [{ id: 's', visible: true }, { id: 'n', visible: false }] }, schema);

    expect(view.visibleProperties).toEqual(['s']);
  });
});

describe('layoutChange', () => {
  it('a board groups by the first select-like property, else the first groupable one', () => {
    expect(layoutChange(table(), 'board', schema)?.changes).toEqual({ type: 'board', groupBy: 's' });
    expect(layoutChange(table(), 'board', schema.filter(p => p.type !== 'status'))?.changes).toEqual({ type: 'board', groupBy: 'n' });
    expect(layoutChange(table(), 'board', schema.filter(p => p.type === 'title'))).toBeUndefined();
  });

  it('a timeline gets empty table columns, and a map asks for a place property when there is none', () => {
    expect(layoutChange(table(), 'timeline', schema)?.changes).toEqual({ type: 'timeline', tableProperties: [] });
    expect(layoutChange(table(), 'map', schema)?.needsPlace).toBe(true);
    expect(layoutChange(table(), 'map', [...schema, { id: 'p', name: 'Place', type: 'place', position: 'a3' }])?.needsPlace).toBe(false);
  });
});
