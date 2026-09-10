import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BlokUploader } from '../../../../types/configs/uploader';
import {
  collectAssetUploaderSources,
  resolveAssetUploader,
  hasAssetUploader,
  uploadAssetFile,
  uploadAssetUrl,
  type AssetUploaderSources,
  type AssetUploaderToolLike,
} from '../../../../src/components/utils/asset-uploader';

const sources = (over: Partial<AssetUploaderSources> = {}): AssetUploaderSources => ({
  editor: undefined,
  byKind: {},
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('collectAssetUploaderSources — partial tool adapters', () => {
  // A tool adapter is host-supplied, so `settings` can be absent at runtime even
  // though the interface declares it. Reading through it throws and takes the
  // whole source table down with it.
  it('skips a tool whose settings are absent rather than reading through it', () => {
    const withoutSettings = { assetKind: 'image' } as unknown as AssetUploaderToolLike;

    const collected = collectAssetUploaderSources([withoutSettings]);

    expect(collected).toStrictEqual({ sweep: undefined, editor: undefined, byKind: {} });
  });

  // `byKind[kind] = undefined` is not the same as leaving the key out: it makes a
  // later tool look like it is claiming an unclaimed kind.
  it('leaves the kind key absent when the tool declares no uploader', () => {
    const noUploader = { assetKind: 'image', settings: {} } as AssetUploaderToolLike;

    const collected = collectAssetUploaderSources([noUploader]);

    expect(collected.byKind).toStrictEqual({});
  });
});

describe('resolveAssetUploader — a kind owner that serves only one method', () => {
  it('leaves uploadByFile unset when the owner declares only uploadByUrl', () => {
    const owner: BlokUploader = { uploadByUrl: vi.fn().mockResolvedValue({ url: 'https://cdn/u' }) };

    const resolved = resolveAssetUploader('image', sources({ byKind: { image: owner } }));

    expect(resolved).toStrictEqual({ uploadByUrl: expect.any(Function) });
  });

  it('leaves uploadByUrl unset when the owner declares only uploadByFile', () => {
    const owner: BlokUploader = { uploadByFile: vi.fn().mockResolvedValue({ url: 'https://cdn/f' }) };

    const resolved = resolveAssetUploader('image', sources({ byKind: { image: owner } }));

    expect(resolved).toStrictEqual({ uploadByFile: expect.any(Function) });
  });
});

// The kind owner is skipped for the method it does not declare, so the
// editor-level uploader is selected — and that method can be missing on it too.
// The wrapper must not be built over a method that does not exist.
describe('resolveAssetUploader — an editor-level uploader with one entry point', () => {
  it('leaves uploadByFile unset when the editor-level uploader serves only URLs', () => {
    const uploader: BlokUploader = { uploadByUrl: vi.fn().mockResolvedValue({ url: 'https://cdn/u' }) };

    const resolved = resolveAssetUploader('image', sources({ editor: uploader, byKind: { image: uploader } }));

    expect(resolved).toStrictEqual({ uploadByUrl: expect.any(Function) });
  });

  it('leaves uploadByUrl unset when the editor-level uploader serves only files', () => {
    const uploader: BlokUploader = { uploadByFile: vi.fn().mockResolvedValue({ url: 'https://cdn/f' }) };

    const resolved = resolveAssetUploader('image', sources({ editor: uploader, byKind: { image: uploader } }));

    expect(resolved).toStrictEqual({ uploadByFile: expect.any(Function) });
  });
});

describe('hasAssetUploader — one entry point is enough', () => {
  it('reports true when only uploadByFile resolves', () => {
    const owner: BlokUploader = { uploadByFile: vi.fn().mockResolvedValue({ url: 'https://cdn/f' }) };

    expect(hasAssetUploader('image', sources({ byKind: { image: owner } }))).toBe(true);
  });

  it('reports true when only uploadByUrl resolves', () => {
    const owner: BlokUploader = { uploadByUrl: vi.fn().mockResolvedValue({ url: 'https://cdn/u' }) };

    expect(hasAssetUploader('image', sources({ byKind: { image: owner } }))).toBe(true);
  });
});

describe('fallbacks when no resolved uploader serves the entry point', () => {
  it('blobs a file when the resolved uploader serves only URLs', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:only-url');
    const uploader: BlokUploader = { uploadByUrl: vi.fn().mockResolvedValue({ url: 'https://cdn/u' }) };
    const file = new File(['x'], 'cover.png', { type: 'image/png' });

    await expect(
      uploadAssetFile(file, { kind: 'image' }, sources({ editor: uploader, byKind: { image: uploader } }))
    ).resolves.toStrictEqual({ url: 'blob:only-url', fileName: 'cover.png' });
  });

  it('stores a URL verbatim when the resolved uploader serves only files', async () => {
    const uploader: BlokUploader = { uploadByFile: vi.fn().mockResolvedValue({ url: 'https://cdn/f' }) };

    await expect(
      uploadAssetUrl('https://third-party/art.png', { kind: 'image' }, sources({ editor: uploader, byKind: { image: uploader } }))
    ).resolves.toStrictEqual({ url: 'https://third-party/art.png' });
  });
});

describe('host failures', () => {
  it('propagates a file upload rejection instead of swallowing it', async () => {
    const owner: BlokUploader = {
      uploadByFile: vi.fn().mockRejectedValue(new Error('quota exceeded')),
    };

    await expect(uploadAssetFile(new File(['x'], 'a.png'), { kind: 'image' }, sources({ byKind: { image: owner } })))
      .rejects.toThrowError(new Error('quota exceeded'));
  });

  it('propagates a URL upload rejection instead of swallowing it', async () => {
    const owner: BlokUploader = {
      uploadByUrl: vi.fn().mockRejectedValue(new Error('host unreachable')),
    };

    await expect(uploadAssetUrl('https://third-party/art.png', { kind: 'image' }, sources({ byKind: { image: owner } })))
      .rejects.toThrowError(new Error('host unreachable'));
  });
});
