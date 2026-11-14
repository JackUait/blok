import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DatabaseData, PropertyDefinition } from '../../../../src/tools/database/types';
import { buildTool, makeDoc } from './tier3-harness';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

const titleOnly: PropertyDefinition[] = [{ id: 'title', name: 'Name', type: 'title', position: 'a0' }];

const dataWith = (schema: PropertyDefinition[]): DatabaseData => ({
  schema,
  views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
  activeViewId: 'v',
});

// notion-motion.md Round 28 §4: a new Board or Calendar on a database without the property creates it.
describe('DatabaseTool — a new view creates the property it needs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('a new Board on a database with no Status or Select adds a Status property and groups by it', () => {
    const { tool, el } = buildTool(makeDoc([]), {}, dataWith(titleOnly));

    tool.addView('board');

    const saved = tool.save(el);
    const statuses = saved.schema.filter((p) => p.type === 'status');

    expect(statuses.map((p) => p.name)).toEqual(['tools.database.propertyTypeStatus']);
    expect(statuses[0].config?.options.map((o) => o.label)).toEqual(['Not started', 'In progress', 'Done']);
    expect(saved.views[1].groupBy).toBe(statuses[0].id);
    expect(el.querySelectorAll('[data-blok-database-column]')).toHaveLength(3);
  });

  it('a new Board on a database that has a Status groups by it and adds none', () => {
    const schema: PropertyDefinition[] = [...titleOnly, { id: 'st', name: 'Stage', type: 'status', position: 'a1', config: { options: [] } }];
    const { tool, el } = buildTool(makeDoc([]), {}, dataWith(schema));

    tool.addView('board');

    const saved = tool.save(el);

    expect(saved.schema.filter((p) => p.type === 'status').map((p) => p.id)).toEqual(['st']);
    expect(saved.views[1].groupBy).toBe('st');
  });

  it('a new Board on a database that has a Select still groups by it and adds no Status', () => {
    const schema: PropertyDefinition[] = [...titleOnly, { id: 'sel', name: 'Kind', type: 'select', position: 'a1', config: { options: [] } }];
    const { tool, el } = buildTool(makeDoc([]), {}, dataWith(schema));

    tool.addView('board');

    const saved = tool.save(el);

    expect(saved.schema.some((p) => p.type === 'status')).toBe(false);
    expect(saved.views[1].groupBy).toBe('sel');
  });

  it('a new Calendar on a database with no Date adds a Date property and draws the month', () => {
    const { tool, el } = buildTool(makeDoc([]), {}, dataWith(titleOnly));

    tool.addView('calendar');

    const dates = tool.save(el).schema.filter((p) => p.type === 'date');

    expect(dates.map((p) => p.name)).toEqual(['tools.database.propertyTypeDate']);
    expect(el.querySelector('[data-blok-database-calendar-empty]')).toBeNull();
    expect(el.querySelector('[data-blok-database-calendar]')).not.toBeNull();
  });

  it('a new Calendar on a database that has a Date adds none', () => {
    const schema: PropertyDefinition[] = [...titleOnly, { id: 'due', name: 'Due', type: 'date', position: 'a1' }];
    const { tool, el } = buildTool(makeDoc([]), {}, dataWith(schema));

    tool.addView('calendar');

    expect(tool.save(el).schema.filter((p) => p.type === 'date').map((p) => p.id)).toEqual(['due']);
  });

  it('a new Table adds no property', () => {
    const { tool, el } = buildTool(makeDoc([]), {}, dataWith(titleOnly));

    tool.addView('table');

    expect(tool.save(el).schema.map((p) => p.id)).toEqual(['title']);
  });
});
