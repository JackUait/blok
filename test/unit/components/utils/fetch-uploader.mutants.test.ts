import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const xhr = vi.hoisted(() => ({
  status: 200,
  text: '{"url":"https://cdn.example.com/x.png"}',
  calls: [] as Record<string, unknown>[],
}));

vi.mock('../../../../src/components/utils/upload-xhr', () => ({
  uploadWithProgress: async (options: Record<string, unknown>): Promise<{ status: number; text: string }> => {
    xhr.calls.push(options);

    return { status: xhr.status, text: xhr.text };
  },
}));

import { createFetchUploader } from '../../../../src/components/utils/fetch-uploader';
import type { DeleteContext, UploadContext } from '../../../../types/configs/uploader';

const CONTEXT = { onProgress: (): void => undefined } as unknown as UploadContext;
const DELETE_CONTEXT = {} as unknown as DeleteContext;

const uploader = (): ReturnType<typeof createFetchUploader> =>
  createFetchUploader({ baseUrl: 'https://api.example.com//' });

const file = (name: string): File => new File([new Uint8Array(4)], name, { type: 'image/png' });

const respondWith = (init: { ok: boolean; status: number; body: string }): void => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: init.ok,
    status: init.status,
    text: async (): Promise<string> => init.body,
  })));
};

const fetchCalls = (): unknown[][] => {
  const stub = globalThis.fetch;

  return vi.isMockFunction(stub) ? stub.mock.calls : [];
};

/**
 * One survivor is equivalent: dropping the `typeof body !== 'object'` test from
 * the guard chain in toAsset. Everything it would have caught falls through to
 * the url test, and no value JSON.parse can produce that is not an object
 * carries a string `url` — so that test throws the very same error. The null
 * case is different, and is killed: null IS an object, so falling through
 * dereferences it.
 */
describe('fetch uploader mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    xhr.status = 200;
    xhr.text = '{"url":"https://cdn.example.com/x.png"}';
    xhr.calls.length = 0;
    respondWith({ ok: true, status: 200, body: '{"url":"https://cdn.example.com/x.png"}' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('uploading a file', () => {
    it('keeps the name the endpoint reports', async () => {
      xhr.text = '{"url":"https://cdn.example.com/x.png","fileName":"server.png"}';

      await expect(uploader().uploadByFile(file('local.png'), CONTEXT)).resolves.toStrictEqual({
        url: 'https://cdn.example.com/x.png',
        fileName: 'server.png',
      });
    });

    it('falls back to the local name when the endpoint reports none', async () => {
      await expect(uploader().uploadByFile(file('local.png'), CONTEXT)).resolves.toStrictEqual({
        url: 'https://cdn.example.com/x.png',
        fileName: 'local.png',
      });
    });

    it('falls back when the reported name is not a string', async () => {
      xhr.text = '{"url":"https://cdn.example.com/x.png","fileName":42}';

      await expect(uploader().uploadByFile(file('local.png'), CONTEXT)).resolves.toStrictEqual({
        url: 'https://cdn.example.com/x.png',
        fileName: 'local.png',
      });
    });

    it('accepts the last success status and refuses the one below the first', async () => {
      xhr.status = 299;
      await expect(uploader().uploadByFile(file('a.png'), CONTEXT)).resolves.toBeDefined();

      xhr.status = 199;
      await expect(uploader().uploadByFile(file('a.png'), CONTEXT)).rejects.toThrow(/status 199/);
    });

    it('trims the trailing slashes off the base URL', async () => {
      await uploader().uploadByFile(file('a.png'), CONTEXT);

      expect(xhr.calls.map((call) => call.url)).toStrictEqual(['https://api.example.com/upload']);
    });

    it('refuses a body that is not an object', async () => {
      xhr.text = '"just a string"';

      await expect(uploader().uploadByFile(file('a.png'), CONTEXT))
        .rejects.toThrow('Upload failed: the endpoint returned no url');
    });

    // A null body is the one value that reaches the url test as a
    // dereference rather than as a miss, so the message is what separates the
    // guard from the TypeError.
    it('refuses a null body without dereferencing it', async () => {
      xhr.text = 'null';

      await expect(uploader().uploadByFile(file('a.png'), CONTEXT))
        .rejects.toThrow('Upload failed: the endpoint returned no url');
    });

    it('refuses a body that is not JSON at all', async () => {
      xhr.text = 'not json';

      await expect(uploader().uploadByFile(file('a.png'), CONTEXT))
        .rejects.toThrow(/malformed/);
    });
  });

  describe('uploading by url', () => {
    it('posts the url as JSON', async () => {
      await uploader().uploadByUrl('https://example.com/a.png', CONTEXT);

      expect(fetchCalls()).toStrictEqual([[
        'https://api.example.com/upload-by-url',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{"url":"https://example.com/a.png"}',
        },
      ]]);
    });

    // The refusal body is valid JSON on purpose: without the ok check the
    // uploader would happily return it as the asset.
    it('reports the status when the endpoint refuses', async () => {
      respondWith({ ok: false, status: 500, body: '{"url":"https://cdn.example.com/x.png"}' });

      await expect(uploader().uploadByUrl('https://example.com/a.png', CONTEXT))
        .rejects.toThrow(/status 500/);
    });
  });

  describe('deleting', () => {
    it('reports the status when the endpoint refuses', async () => {
      respondWith({ ok: false, status: 404, body: '{}' });

      await expect(uploader().delete('https://cdn.example.com/x.png', DELETE_CONTEXT))
        .rejects.toThrow(/delete failed with status 404/);
    });
  });
});
