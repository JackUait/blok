// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dataOf, errorOf, property, run, seedOf, SESSIONS } from './database-seed';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const seed = () => seedOf([{ id: 'A', schema: [property('t', 'title'), property('tags', 'multiSelect')], rows: [] }]);

const tags = async (session: Parameters<typeof dataOf>[0]): Promise<Record<string, unknown> | undefined> =>
  ((await dataOf(session, 'A'))?.schema as Array<Record<string, unknown>>).find(each => each.id === 'tags');

// notion-spec-2 §17.3: Edit property's Sort row.
describe.each(SESSIONS)('database option Sort (%s session)', (_label, open) => {
  it('updateProperty sets optionSort, and null puts it back on Manual', async () => {
    const session = open(seed());

    expect(errorOf(await run(session, 'database.updateProperty', { id: 'A', propertyId: 'tags', settings: { optionSort: 'reverseAlphabetical' } }))).toBeUndefined();
    expect((await tags(session))?.optionSort).toBe('reverseAlphabetical');
    await run(session, 'database.updateProperty', { id: 'A', propertyId: 'tags', settings: { optionSort: null } });
    expect(await tags(session)).not.toHaveProperty('optionSort');
    await session.close();
  });

  it('refuses a Sort Notion does not have', async () => {
    const session = open(seed());

    expect(errorOf(await run(session, 'database.updateProperty', { id: 'A', propertyId: 'tags', settings: { optionSort: 'byColor' } }))).toBeDefined();
    await session.close();
  });
});
