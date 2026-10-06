import { describe, expect, it, vi } from 'vitest';
import { nodeDigests } from '../../scripts/source-digest.mjs';
import { PRERENDER_PATHS } from '../prerender-paths';
import { LASTMOD_LEDGER } from './lastmod';
import { localizedPrerenderPaths } from './locales';
import { fingerprintRoutes, pageData } from './page-fingerprint';

// A release bump changes only BLOK_VERSION. If it moved a fingerprint, the
// release commit would fail the ledger test and the tag build would throw.
vi.mock('../utils/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/constants')>()),
  BLOK_VERSION: '999.0.0',
}));

describe('page fingerprints across a release bump', () => {
  it('match the committed ledger with a different version', () => {
    const routes = localizedPrerenderPaths(PRERENDER_PATHS);
    const data = pageData();
    expect(data.version).toBe('999.0.0');

    const fingerprints = fingerprintRoutes(routes, { ...data, ...nodeDigests });
    const moved = routes.filter((route) => fingerprints[route] !== LASTMOD_LEDGER[route]?.hash);

    expect(moved).toEqual([]);
  });
});
