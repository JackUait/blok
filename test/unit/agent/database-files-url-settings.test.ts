// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dataOf, errorOf, property, run, seedOf, SESSIONS } from './database-seed';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const seed = () => seedOf([{ id: 'A', schema: [property('t', 'title'), property('f', 'files'), property('u', 'url')], rows: [] }]);

const prop = async (session: Parameters<typeof dataOf>[0], id: string): Promise<Record<string, unknown> | undefined> =>
  ((await dataOf(session, 'A'))?.schema as Array<Record<string, unknown>>).find(each => each.id === id);

// notion-spec-2 §19.21, §20.7: Files' Limit and URL's Show full URL, as the header menu writes them.
describe.each(SESSIONS)('database Files limit and URL Show full URL (%s session)', (_label, open) => {
  it('updateProperty sets files.limit 1, and null puts it back on No limit', async () => {
    const session = open(seed());

    expect(errorOf(await run(session, 'database.updateProperty', { id: 'A', propertyId: 'f', settings: { files: { limit: 1 } } }))).toBeUndefined();
    expect((await prop(session, 'f'))?.files).toEqual({ limit: 1 });
    await run(session, 'database.updateProperty', { id: 'A', propertyId: 'f', settings: { files: null } });
    expect(await prop(session, 'f')).not.toHaveProperty('files');
    await session.close();
  });

  it('updateProperty sets url.showFullUrl, and null turns it off', async () => {
    const session = open(seed());

    expect(errorOf(await run(session, 'database.updateProperty', { id: 'A', propertyId: 'u', settings: { url: { showFullUrl: true } } }))).toBeUndefined();
    expect((await prop(session, 'u'))?.url).toEqual({ showFullUrl: true });
    await run(session, 'database.updateProperty', { id: 'A', propertyId: 'u', settings: { url: null } });
    expect(await prop(session, 'u')).not.toHaveProperty('url');
    await session.close();
  });

  it('refuses a files limit Notion does not have', async () => {
    const session = open(seed());

    expect(errorOf(await run(session, 'database.updateProperty', { id: 'A', propertyId: 'f', settings: { files: { limit: 2 } } }))).toBeDefined();
    await session.close();
  });
});
