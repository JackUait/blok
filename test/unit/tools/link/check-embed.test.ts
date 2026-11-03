import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHECK_EMBED_TIMEOUT_MS, embedCheckRefuses } from '../../../../src/tools/link/check-embed';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('embedCheckRefuses — the host frame check is a hint that can only say no', () => {
  it.each(['blocked', 'insecure'] as const)('refuses on %s', async (verdict) => {
    await expect(embedCheckRefuses(async () => ({ verdict }), 'https://a.test/')).resolves.toBe(true);
  });

  it.each(['allowed', 'unknown'] as const)('proceeds on %s', async (verdict) => {
    await expect(embedCheckRefuses(async () => ({ verdict }), 'https://a.test/')).resolves.toBe(false);
  });

  it('proceeds when there is no check', async () => {
    await expect(embedCheckRefuses(undefined, 'https://a.test/')).resolves.toBe(false);
  });

  it('proceeds when the check rejects, throws or answers nonsense', async () => {
    const answers: Array<() => Promise<{ verdict: 'allowed' | 'blocked' | 'insecure' | 'unknown' }>> = [
      () => Promise.reject(new Error('down')),
      () => {
        throw new Error('sync');
      },
      () => Promise.resolve(null as unknown as { verdict: 'blocked' }),
      () => Promise.resolve({ verdict: 'BLOCKED' } as unknown as { verdict: 'blocked' }),
    ];

    for (const check of answers) {
      await expect(embedCheckRefuses(check, 'https://a.test/')).resolves.toBe(false);
    }
  });

  it('passes the URL to the check', async () => {
    const check = vi.fn(async () => ({ verdict: 'allowed' as const }));

    await embedCheckRefuses(check, 'https://a.test/x');

    expect(check).toHaveBeenCalledWith('https://a.test/x');
  });

  it('proceeds after the time cap when the check never answers', async () => {
    vi.useFakeTimers();

    const result = embedCheckRefuses(() => new Promise(() => undefined), 'https://a.test/');

    await vi.advanceTimersByTimeAsync(CHECK_EMBED_TIMEOUT_MS);

    await expect(result).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores a late "blocked" that lands after the cap', async () => {
    vi.useFakeTimers();

    const result = embedCheckRefuses(
      () => new Promise((resolve) => setTimeout(() => resolve({ verdict: 'blocked' }), CHECK_EMBED_TIMEOUT_MS + 500)),
      'https://a.test/'
    );

    await vi.advanceTimersByTimeAsync(CHECK_EMBED_TIMEOUT_MS + 1000);

    await expect(result).resolves.toBe(false);
  });

  it('clears its timer when the check answers in time', async () => {
    vi.useFakeTimers();

    await embedCheckRefuses(async () => ({ verdict: 'blocked' }), 'https://a.test/');

    expect(vi.getTimerCount()).toBe(0);
  });
});
