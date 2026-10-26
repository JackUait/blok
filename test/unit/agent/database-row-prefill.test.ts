// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dataOf, errorOf, property, row, run, seedOf, SESSIONS, valuesOf } from './database-seed';

import type { AgentResult, OutputData } from '../../../types';

const OPTIONS = { config: { options: [{ id: 'red', label: 'Red', position: 'a0' }, { id: 'blue', label: 'Blue', position: 'a1' }] } };
const SCHEMA = [property('t', 'title'), property('tag', 'select', OPTIONS), property('who', 'person'), property('done', 'checkbox'), property('n', 'number')];

/** A view showing red rows of mine that are done, the done rule inside an AND tree. */
const filtered = (extra: Record<string, unknown> = {}): OutputData => seedOf([{
  id: 'S',
  schema: SCHEMA,
  rows: [row('a', { t: 'a', tag: 'red', who: [{ id: 'human-1' }], done: true })],
  view: {
    filters: [
      { id: 'f1', propertyId: 'tag', operator: 'equals', value: 'red' },
      { id: 'f2', propertyId: 'who', operator: 'contains', value: ['me'] },
    ],
    filterTree: { id: 'g', conjunction: 'and', filterRules: [{ id: 'r1', propertyId: 'done', operator: 'equals', value: true }] },
    ...extra,
  },
}]);

const rowIdOf = (result: AgentResult): string => {
  const value = result.ok ? result.results[0] : undefined;

  return typeof value === 'object' && value !== null && 'rowId' in value ? String(value.rowId) : '';
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(SESSIONS)('a new row matches the open view filter (%s session)', (_label, open) => {
  it('database.addRow fills the values the filter asks for, as New in the view does', async () => {
    const session = open(filtered());
    const result = await run(session, 'database.addRow', { id: 'S' });

    expect(errorOf(result)).toBeUndefined();
    expect(await valuesOf(session, rowIdOf(result))).toMatchObject({ tag: 'red', who: [{ id: 'human-1' }], done: true });
    await session.close();
  });

  it('the values the caller names win over the filter', async () => {
    const session = open(filtered());
    const result = await run(session, 'database.addRow', { id: 'S', values: { tag: 'blue' } });

    expect(errorOf(result)).toBeUndefined();
    expect(await valuesOf(session, rowIdOf(result))).toMatchObject({ tag: 'blue', done: true });
    await session.close();
  });

  it('the filter wins over the default template, as in the editor', async () => {
    const data = filtered();
    const database = data.blocks.find(block => block.id === 'S');
    const title = (database?.data.schema as Array<Record<string, unknown>>)[0];

    title.defaultTemplateId = 'tpl';
    database?.content?.push('tpl');
    data.blocks.push({ id: 'tpl', type: 'database-row', parent: 'S', data: { template: true, title: 'Bug', position: 'a9', properties: { t: 'Bug', tag: 'blue', n: 5 } } });
    const session = open(data);
    const result = await run(session, 'database.addRow', { id: 'S' });

    expect(errorOf(result)).toBeUndefined();
    expect(await valuesOf(session, rowIdOf(result))).toMatchObject({ tag: 'red', n: 5 });
    await session.close();
  });

  it('a filter naming a deleted option does not refuse the row', async () => {
    const session = open(filtered({ filters: [{ id: 'f1', propertyId: 'tag', operator: 'equals', value: 'gone' }], filterTree: undefined }));
    const result = await run(session, 'database.addRow', { id: 'S' });

    expect(errorOf(result)).toBeUndefined();
    expect(await dataOf(session, rowIdOf(result))).toBeDefined();
    await session.close();
  });
});
