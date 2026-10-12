// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openStoreSession } from '../harness';
import { callerChosenIds, expectationFor, loadParityCases } from './corpus';
import { normalizeForParity } from './normalize';
import { compareToGolden, runCorpusCase } from './run-case';

describe.each(loadParityCases())('store runner: $name', (c) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('matches the json golden', async () => {
    const session = openStoreSession(c.seed);

    try {
      const outcome = await runCorpusCase(session, c);

      expect(outcome).toEqual(expectationFor(c, 'store'));

      // A runner that refuses where json succeeds has no golden to match.
      if (outcome === 'ok' && expectationFor(c, 'json') === 'ok') {
        compareToGolden(c, normalizeForParity(session.output(), callerChosenIds(c)));
      }
    } finally {
      await session.close();
    }
  });
});
