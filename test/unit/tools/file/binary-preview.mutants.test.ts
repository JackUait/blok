import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { loadBinaryPreview } from '../../../../src/tools/file/binary-preview';

const responding = (init: { ok: boolean }): ArrayBuffer => {
  const buf = new ArrayBuffer(8);

  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: init.ok,
    arrayBuffer: async (): Promise<ArrayBuffer> => buf,
  })));

  return buf;
};

describe('loadBinaryPreview mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the body of a successful response', async () => {
    const buf = responding({ ok: true });

    await expect(loadBinaryPreview('https://example.com/a.docx')).resolves.toStrictEqual({ ok: true, buf });
  });

  // The body of a refusal parses perfectly well, so only the status check keeps
  // an error page out of the office renderer.
  it('refuses a non-2xx response even though its body reads fine', async () => {
    responding({ ok: false });

    await expect(loadBinaryPreview('https://example.com/a.docx'))
      .resolves.toStrictEqual({ ok: false, reason: 'fetch-error' });
  });

  it('refuses a fetch that threw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));

    await expect(loadBinaryPreview('https://example.com/a.docx'))
      .resolves.toStrictEqual({ ok: false, reason: 'fetch-error' });
  });
});
