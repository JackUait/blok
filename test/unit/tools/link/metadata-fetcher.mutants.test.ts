/**
 * Guards for the unfurl-response checks that a mutation run found unasserted.
 *
 * The pre-existing non-ok test could not see the HTTP guard disappear: its
 * stub response carried no `json`, so skipping the guard still rejected — with
 * a TypeError instead of the status error. The stub here answers `json`, so
 * only the guard itself can make the call reject.
 *
 * No survivors.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MetadataFetcher } from '../../../../src/tools/link/metadata-fetcher';

const respondWith = (body: unknown, init: { ok: boolean; status: number }): Response =>
  ({
    ok: init.ok,
    status: init.status,
    json: () => Promise.resolve(body),
  }) as unknown as Response;

describe('MetadataFetcher mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects with the status even when a failed response still carries a body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      respondWith({ success: 1, meta: { title: 'Served from an error page' } }, { ok: false, status: 500 })
    );
    const fetcher = new MetadataFetcher({ endpoint: 'https://api.test/unfurl' });

    await expect(fetcher.fetch('https://example.com/a')).rejects.toThrow(
      'Metadata request failed with status 500.'
    );
  });

  it('names the unsuccessful backend response in the error it throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      respondWith({ success: 0 }, { ok: true, status: 200 })
    );
    const fetcher = new MetadataFetcher({ endpoint: 'https://api.test/unfurl' });

    await expect(fetcher.fetch('https://example.com/a')).rejects.toThrow(
      'Metadata request was unsuccessful.'
    );
  });

  it('prefers the canonical link the backend resolved over the requested url', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      respondWith(
        { success: 1, link: 'https://example.com/canonical', meta: { title: 'T' } },
        { ok: true, status: 200 }
      )
    );
    const fetcher = new MetadataFetcher({ endpoint: 'https://api.test/unfurl' });

    const meta = await fetcher.fetch('https://example.com/a?utm_source=x');

    expect(meta.url).toBe('https://example.com/canonical');
  });
});
