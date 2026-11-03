// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openJsonSession } from './harness';

const seed = { blocks: [{ id: 'p', type: 'paragraph', data: { text: 'P' } }] };

const sessionWithFetch = () => {
  const fetch = vi.fn(async (url: string) => ({ url, title: 'T' }));
  const session = openJsonSession(seed, undefined, { names: ['linkMetadata'], impl: { linkMetadata: { fetch } } });

  return { fetch, session };
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('bookmark.create checks the URL before any metadata fetch', () => {
  it('fetches metadata for an https URL', async () => {
    const { fetch, session } = sessionWithFetch();
    const result = await session.execute({ commands: [{ name: 'bookmark.create', args: { url: 'https://a.example/x' } }] });

    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('https://a.example/x');
  });

  it.each([
    ['javascript:alert(1)'],
    ['ftp://a.example/x'],
    ['file:///etc/passwd'],
  ])('refuses %s without fetching', async (url) => {
    const { fetch, session } = sessionWithFetch();
    const result = await session.execute({ commands: [{ name: 'bookmark.create', args: { url } }] });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe('INVALID_ARGS');
    expect(fetch).not.toHaveBeenCalled();
  });
});
