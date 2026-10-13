// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openJsonSession, validateSaved } from '../harness';
import { callerChosenIds, expectationFor, hostServicesFor, loadParityCases } from './corpus';
import { normalizeForParity } from './normalize';
import { compareToGolden, runCorpusCase } from './run-case';

const cases = loadParityCases();

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

it('has cases to exercise', () => {
  expect(cases.length).toBeGreaterThan(0);
});

describe.each(cases)('json runner: $name', (c) => {
  it('matches its expectation, the saved schema and the golden', async () => {
    const session = openJsonSession(c.seed, undefined, hostServicesFor(c));

    try {
      const outcome = await runCorpusCase(session, c);

      expect(outcome).toEqual(expectationFor(c, 'json'));
      const output = session.output();

      expect(validateSaved(output)).toEqual([]);
      compareToGolden(c, normalizeForParity(output, callerChosenIds(c)));
    } finally {
      session.close();
    }
  });
});
