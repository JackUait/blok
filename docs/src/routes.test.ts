import { describe, expect, it } from 'vitest';
import routes from './routes';

type Entry = { id?: string; path?: string; index?: boolean; file: string };

const entries = routes as Entry[];

/** The catch-all is deliberately shared by both trees. */
const SPLAT = '*';

const pathsOf = (predicate: (entry: Entry) => boolean): string[] =>
  entries.filter(predicate).map((entry) => entry.path ?? (entry.index ? '' : SPLAT));

describe('route table', () => {
  const russian = entries.filter((entry) => entry.path?.startsWith('ru'));
  const english = entries.filter(
    (entry) => !entry.path?.startsWith('ru') && entry.path !== SPLAT,
  );

  it('mirrors every English route under the /ru prefix', () => {
    const expected = pathsOf((entry) => english.includes(entry)).map((path) =>
      path === '' ? 'ru' : `ru/${path}`,
    );
    const missing = expected.filter((path) => !russian.some((entry) => entry.path === path));
    expect(missing).toEqual([]);
  });

  it('adds no Russian route the English tree does not have', () => {
    const englishPaths = new Set(
      pathsOf((entry) => english.includes(entry)).map((path) => (path === '' ? 'ru' : `ru/${path}`)),
    );
    const extra = russian.map((entry) => entry.path).filter((path) => !englishPaths.has(path ?? ''));
    expect(extra).toEqual([]);
  });

  it('reuses the same route modules rather than duplicating page components', () => {
    const englishFiles = new Set(english.map((entry) => entry.file));
    const foreign = russian.filter((entry) => !englishFiles.has(entry.file));
    expect(foreign).toEqual([]);
  });

  it('gives every route a unique id, which a duplicated module requires', () => {
    const ids = entries.map((entry) => entry.id ?? entry.file);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('keeps a single catch-all so an unknown path in either tree renders the 404 page', () => {
    expect(entries.filter((entry) => entry.path === SPLAT)).toHaveLength(1);
  });
});
