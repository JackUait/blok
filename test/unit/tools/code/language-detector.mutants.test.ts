import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { detectLanguage } from '../../../../src/tools/code/language-detector';
import { tokenizePrism } from '../../../../src/tools/code/prism-loader';

vi.mock('../../../../src/tools/code/prism-loader', () => ({
  tokenizePrism: vi.fn(),
}));

/**
 * Mutant-killing tests for src/tools/code/language-detector.ts.
 *
 * Four recorded live mutants are PROVEN equivalent — every one of them lands on
 * a path that already returns null:
 *
 * 1. The empty-array fallback for a failed match becoming a one-element array.
 *    The fallback is only reached when String.prototype.match found nothing.
 *    The mutant array holds the literal Stryker marker, so the length check
 *    passes, but the type extraction slices that marker down to the two-letter
 *    string "er" (measured) and the resulting Set has size 1. One distinct type
 *    is below the minimum of 2, so scoreLanguage returns null — which is what
 *    the original returns from the length check. Same value, no side effects.
 *
 * 2. The zero-length guard on the match result becoming false. Falling through
 *    with an empty array produces an empty Set, whose size 0 is again below the
 *    minimum of 2, so the very next guard returns null. Same value.
 *
 * 3. The null-score guard in the reduce becoming false. A null score then
 *    competes: null in a relational comparison reads as 0 (measured), so it
 *    only beats the seed score of -Infinity, and only on the first candidate.
 *    Every scoreLanguage result is a ratio strictly greater than 0, so the
 *    first real score replaces that null accumulator exactly as it would have
 *    replaced the seed, and the maximum from there on is unchanged. When no
 *    candidate scores at all, the accumulator holds the first language with a
 *    null score; the final guard then compares null against the minimum ratio,
 *    which is true (measured), so the function still returns null.
 *
 * 4. The null-language half of the final guard becoming false. That half is
 *    only true when no candidate scored, and in exactly that case the score is
 *    still the seed -Infinity, which is below the minimum ratio. The second
 *    half of the disjunction is therefore already true whenever the first one
 *    is, so dropping the first cannot change the result.
 */

const mockTokenizePrism = vi.mocked(tokenizePrism);

/** Builds Prism-shaped output with one span per entry, typed by that entry. */
const spans = (types: string[]): string =>
  types.map((type) => `<span class="token ${type}">x</span>`).join('');

const repeated = (types: string[], times: number): string[] =>
  Array.from({ length: times }, () => types).flat();

/** Answers with tokenized output for the named languages and null for the rest. */
const respondWith = (byLanguage: Record<string, string>): void => {
  mockTokenizePrism.mockImplementation((_code: string, lang: string) =>
    Promise.resolve(byLanguage[lang] ?? null));
};

const CODE = 'const a = 1;\nconst b = 2;\nfunction f() { return a + b; }';

describe('language-detector mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a tokenization with exactly the minimum number of distinct types', async () => {
    respondWith({ javascript: spans(['keyword', 'string']) });

    await expect(detectLanguage(CODE)).resolves.toBe('javascript');
  });

  it('scores by type diversity rather than by raw token count', async () => {
    // javascript: 2 types over 2 spans. python: 3 types over 12 spans.
    // Diversity picks javascript; a product of the two would pick python.
    respondWith({
      javascript: spans(['keyword', 'string']),
      python: spans(repeated(['keyword', 'string', 'operator'], 4)),
    });

    await expect(detectLanguage(CODE)).resolves.toBe('javascript');
  });

  it('detects code that is exactly at the minimum length', async () => {
    const shortest = 'const a=1;const b=2;';

    expect(shortest).toHaveLength(20);
    respondWith({ javascript: spans(['keyword', 'string']) });

    await expect(detectLanguage(shortest)).resolves.toBe('javascript');
  });

  it('keeps the best-scoring language rather than the last one scored', async () => {
    // javascript scores 9/10, python 3/10, and python is later in the list.
    respondWith({
      javascript: spans(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'i']),
      python: spans(repeated(['keyword', 'string', 'operator'], 3).concat('keyword')),
    });

    await expect(detectLanguage(CODE)).resolves.toBe('javascript');
  });

  it('breaks a score tie in favour of the earlier candidate', async () => {
    const tied = spans(['keyword', 'string', 'keyword', 'string']);

    respondWith({ javascript: tied, python: tied });

    await expect(detectLanguage(CODE)).resolves.toBe('javascript');
  });

  it('rejects a winner whose diversity is below the acceptable ratio', async () => {
    // 2 distinct types over 20 spans is a ratio of 0.1.
    respondWith({ javascript: spans(repeated(['keyword', 'string'], 10)) });

    await expect(detectLanguage(CODE)).resolves.toBeNull();
  });

  it('accepts a winner sitting exactly on the acceptable ratio', async () => {
    // 2 distinct types over 10 spans is a ratio of 0.2.
    respondWith({ javascript: spans(repeated(['keyword', 'string'], 5)) });

    await expect(detectLanguage(CODE)).resolves.toBe('javascript');
  });
});
