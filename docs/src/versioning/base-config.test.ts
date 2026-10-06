import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const load = async () => {
  vi.resetModules();
  const rr = (await import('../../react-router.config')).default;
  const vite = (await import('../../vite.config')).default;
  return { rr, vite };
};

describe('docs base path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('serves from the site root by default', async () => {
    vi.stubEnv('DOCS_BASE', '');
    const { rr, vite } = await load();
    expect(rr.basename).toBe('/');
    expect(vite.base).toBe('/');
  });

  it('builds under the DOCS_BASE subpath', async () => {
    vi.stubEnv('DOCS_BASE', '/v/1.14/');
    const { rr, vite } = await load();
    expect(rr.basename).toBe('/v/1.14/');
    expect(vite.base).toBe('/v/1.14/');
  });
});
