import { afterEach, describe, expect, it, vi } from 'vitest';

const BUILD = '../../../../src/tools/database/database-starter-build';
const STARTERS = '../../../../src/tools/database/database-starters';

describe('loadStarterBuilder', () => {
  afterEach(() => {
    vi.doUnmock(BUILD);
    vi.resetModules();
  });

  it('asks for the builder again after a failed download', async () => {
    vi.resetModules();
    vi.doMock(BUILD, () => {
      throw new Error('chunk load failed');
    });
    const { loadStarterBuilder } = await import(STARTERS);

    await expect(loadStarterBuilder()).rejects.toThrow();

    vi.doUnmock(BUILD);
    vi.resetModules();
    const build = await loadStarterBuilder();

    expect(build('skills', { t: (key: string) => key, newId: () => 'id', titleId: 'title' }).schema.map((p: { type: string }) => p.type))
      .toEqual(['title', 'text', 'files', 'multiSelect', 'createdBy']);
  });

  it('loads the builder once for every caller', async () => {
    const { loadStarterBuilder } = await import(STARTERS);

    expect(loadStarterBuilder()).toBe(loadStarterBuilder());
    await loadStarterBuilder();
  });
});
