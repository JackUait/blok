import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadBinaryPreview } from '../../../../src/tools/file/binary-preview';

describe('loadBinaryPreview', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns the ArrayBuffer on a 2xx response', async () => {
    const buf = new ArrayBuffer(8);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(buf) }));
    const result = await loadBinaryPreview('blob:abc');
    expect(result).toEqual({ ok: true, buf });
  });

  it('returns fetch-error on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await loadBinaryPreview('blob:abc')).toEqual({ ok: false, reason: 'fetch-error' });
  });

  it('returns fetch-error when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    expect(await loadBinaryPreview('blob:abc')).toEqual({ ok: false, reason: 'fetch-error' });
  });
});
