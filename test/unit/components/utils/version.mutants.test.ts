import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getBlokVersion } from '../../../../src/components/utils/version';

/**
 * Fifteen survivors are equivalent, and one fact covers them: the globalThis
 * fallback runs only when there is nothing to find. The bare `VERSION` the
 * first guard tests and the `globalThis.VERSION` the fallback reads are the
 * same binding whenever the source is not bundled, and a bundled build folds
 * the identifier to a literal — so the guard is true exactly when the fallback
 * would have found a value. The fallback therefore always sees `undefined`,
 * which is neither an object-shape question nor a non-blank string, so every
 * arm of both checks answers the same way.
 *
 * The one mutant that is NOT equivalent there is forcing the string check
 * true, because that returns the `undefined` the check exists to reject.
 */
describe('getBlokVersion mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('answers dev when no version was injected', () => {
    expect(getBlokVersion()).toBe('dev');
  });

  // An injected version is trusted as it stands: reaching the fallback instead
  // would reject this one as blank and answer dev.
  it('returns an injected version verbatim, blank or not', () => {
    vi.stubGlobal('VERSION', '   ');

    expect(getBlokVersion()).toBe('   ');

    vi.stubGlobal('VERSION', '1.2.3');

    expect(getBlokVersion()).toBe('1.2.3');
  });
});
