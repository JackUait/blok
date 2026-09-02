import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BlokUploader } from '../../../types/configs/uploader';
import type { OutputData } from '../../../types';
import { createOrphanSweep, type OrphanSweep } from '../../../src/components/utils/orphan-sweep';
import {
  resolveAssetUploader,
  uploadAssetFile,
  uploadAssetUrl,
  hasAssetUploader,
  collectAssetUploaderSources,
  type AssetUploaderSources,
} from '../../../src/components/utils/asset-uploader';

const sources = (over: Partial<AssetUploaderSources> = {}): AssetUploaderSources => ({
  editor: undefined,
  byKind: {},
  ...over,
});

const uploaderWith = (label: string): BlokUploader => ({
  uploadByFile: vi.fn().mockResolvedValue({ url: `https://cdn/${label}-file` }),
  uploadByUrl: vi.fn().mockResolvedValue({ url: `https://cdn/${label}-url` }),
});

// A fresh set per test: it belongs to one editor, so nothing may leak from the
// case before it.
let sweep: OrphanSweep = createOrphanSweep();

beforeEach(() => {
  vi.clearAllMocks();
  sweep = createOrphanSweep();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveAssetUploader', () => {
  it('prefers the uploader owned by the asset kind over the editor-level one', () => {
    const image = uploaderWith('image');
    const editor = uploaderWith('editor');

    const resolved = resolveAssetUploader('image', sources({ editor, byKind: { image } }));

    expect(resolved.uploadByFile).toBeDefined();
    void resolved.uploadByFile?.(new File(['x'], 'a.png'), { kind: 'image' });
    expect(image.uploadByFile).toHaveBeenCalled();
    expect(editor.uploadByFile).not.toHaveBeenCalled();
  });

  it('falls back to the editor-level uploader when no tool owns the kind', () => {
    const editor = uploaderWith('editor');
    const audio = uploaderWith('audio');

    // An audio block uploading cover art asks for kind 'image'; only the audio
    // tool has an uploader, and it must NOT receive the image.
    const resolved = resolveAssetUploader('image', sources({ editor, byKind: { audio }, sweep }));

    void resolved.uploadByFile?.(new File(['x'], 'a.png'), { kind: 'image' });
    expect(editor.uploadByFile).toHaveBeenCalled();
    expect(audio.uploadByFile).not.toHaveBeenCalled();
  });

  it('never routes an asset to a tool that owns a different kind', () => {
    const audio = uploaderWith('audio');

    const resolved = resolveAssetUploader('image', sources({ byKind: { audio } }));

    expect(resolved.uploadByFile).toBeUndefined();
    expect(resolved.uploadByUrl).toBeUndefined();
  });

  it('resolves each method independently', () => {
    const image: BlokUploader = { uploadByUrl: vi.fn().mockResolvedValue({ url: 'u' }) };
    const editor = uploaderWith('editor');

    const resolved = resolveAssetUploader('image', sources({ editor, byKind: { image } }));

    void resolved.uploadByUrl?.('https://x/y.png', { kind: 'image' });
    expect(image.uploadByUrl).toHaveBeenCalled();

    // The kind-owner declares no uploadByFile, so the editor-level one serves it.
    void resolved.uploadByFile?.(new File(['x'], 'a.png'), { kind: 'image' });
    expect(editor.uploadByFile).toHaveBeenCalled();
  });

  it('keeps uploader methods bound to their own object', async () => {
    const host = {
      base: 'https://cdn',
      uploadByFile(): Promise<{ url: string }> {
        return Promise.resolve({ url: `${this.base}/ok` });
      },
    };
    const resolved = resolveAssetUploader('image', sources({ byKind: { image: host } }));

    await expect(resolved.uploadByFile?.(new File(['x'], 'a.png'), { kind: 'image' }))
      .resolves.toEqual({ url: 'https://cdn/ok' });
  });
});

describe('collectAssetUploaderSources', () => {
  const adapter = (name: string, assetKind: 'image' | 'audio' | undefined, uploader?: BlokUploader) =>
    ({ name, assetKind, settings: uploader ? { uploader } : {} });

  it('keys each tool uploader by the asset kind the tool declares', () => {
    const image = uploaderWith('image');
    const audio = uploaderWith('audio');

    const collected = collectAssetUploaderSources([
      adapter('image', 'image', image),
      adapter('audio', 'audio', audio),
      adapter('paragraph', undefined),
    ]);

    expect(collected.byKind.image).toBe(image);
    expect(collected.byKind.audio).toBe(audio);
  });

  it('ignores tools with no assetKind and tools with no uploader', () => {
    const collected = collectAssetUploaderSources([
      adapter('paragraph', undefined, uploaderWith('nope')),
      adapter('image', 'image'),
    ]);

    expect(collected.byKind).toEqual({});
  });

  it('carries the editor-level uploader through', () => {
    const editor = uploaderWith('editor');

    expect(collectAssetUploaderSources([], editor).editor).toBe(editor);
  });

  it('lets the first tool claiming a kind win, so a custom tool cannot silently steal it', () => {
    const first = uploaderWith('first');
    const second = uploaderWith('second');

    const collected = collectAssetUploaderSources([
      adapter('image', 'image', first),
      adapter('my-image', 'image', second),
    ]);

    expect(collected.byKind.image).toBe(first);
  });
});

describe('hasAssetUploader', () => {
  it('reports whether a host uploader will handle the kind', () => {
    const image = uploaderWith('image');

    expect(hasAssetUploader('image', sources({ byKind: { image }, sweep }))).toBe(true);
    expect(hasAssetUploader('video', sources({ byKind: { image }, sweep }))).toBe(false);
    expect(hasAssetUploader('video', sources({ editor: uploaderWith('e') }))).toBe(true);
  });

  it('can be narrowed to a single method', () => {
    const image: BlokUploader = { uploadByUrl: vi.fn() };

    expect(hasAssetUploader('image', sources({ byKind: { image }, sweep }), 'uploadByUrl')).toBe(true);
    expect(hasAssetUploader('image', sources({ byKind: { image }, sweep }), 'uploadByFile')).toBe(false);
  });
});

describe('uploadAssetFile', () => {
  it('passes the full context through to the host uploader', async () => {
    const image = uploaderWith('image');
    const onProgress = vi.fn();
    const file = new File(['x'], 'cover.png', { type: 'image/png' });

    await uploadAssetFile(file, { kind: 'image', tool: 'audio', onProgress }, sources({ byKind: { image }, sweep }));

    expect(image.uploadByFile).toHaveBeenCalledWith(file, {
      kind: 'image',
      tool: 'audio',
      onProgress,
    });
  });

  it('falls back to a blob URL when nothing handles the kind', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    const file = new File(['x'], 'cover.png', { type: 'image/png' });

    await expect(uploadAssetFile(file, { kind: 'image' }, sources()))
      .resolves.toEqual({ url: 'blob:fake', fileName: 'cover.png' });
  });
});

describe('uploadAssetUrl', () => {
  it('re-hosts through the resolved uploader', async () => {
    const image = uploaderWith('image');

    await expect(uploadAssetUrl('https://third-party/art.png', { kind: 'image' }, sources({ byKind: { image }, sweep })))
      .resolves.toEqual({ url: 'https://cdn/image-url' });
    expect(image.uploadByUrl).toHaveBeenCalled();
  });

  it('stores the URL verbatim when nothing handles the kind', async () => {
    await expect(uploadAssetUrl('https://third-party/art.png', { kind: 'image' }, sources()))
      .resolves.toEqual({ url: 'https://third-party/art.png' });
  });
});

describe('deleting what a session uploaded', () => {
  const EMPTY_DOCUMENT: OutputData = { time: 0, version: '1', blocks: [] };


  const deletableUploader = (label: string): BlokUploader => ({
    uploadByFile: vi.fn().mockResolvedValue({ url: `https://cdn/${label}-file` }),
    uploadByUrl: vi.fn().mockResolvedValue({ url: `https://cdn/${label}-url` }),
    delete: vi.fn().mockResolvedValue(undefined),
  });

  it('routes a deletion by asset kind, like every other method', async () => {
    const image = deletableUploader('image');
    const audio = deletableUploader('audio');

    const resolved = resolveAssetUploader('image', sources({ editor: audio, byKind: { image } }));

    await resolved.delete?.('https://cdn/image-file', { kind: 'image', tool: 'audio' });

    expect(image.delete).toHaveBeenCalled();
    expect(audio.delete).not.toHaveBeenCalled();
  });

  it('falls back to the editor-level delete when no tool owns the kind', async () => {
    const editor = deletableUploader('editor');
    const audio = deletableUploader('audio');

    const resolved = resolveAssetUploader('image', sources({ editor, byKind: { audio }, sweep }));

    await resolved.delete?.('https://cdn/editor-file', { kind: 'image' });

    expect(editor.delete).toHaveBeenCalled();
    expect(audio.delete).not.toHaveBeenCalled();
  });

  it('records an uploaded file so a later sweep can delete it, with the kind that stored it', async () => {
    const image = deletableUploader('image');
    const file = new File(['x'], 'cover.png', { type: 'image/png' });

    await uploadAssetFile(file, { kind: 'image', tool: 'audio' }, sources({ byKind: { image }, sweep }));
    await sweep.sweep(EMPTY_DOCUMENT);

    expect(image.delete).toHaveBeenCalledWith('https://cdn/image-file', { kind: 'image', tool: 'audio' });
  });

  it('records an asset re-hosted from a URL too', async () => {
    const record = vi.spyOn(sweep, 'record');
    const image = deletableUploader('image');

    await uploadAssetUrl('https://third-party/art.png', { kind: 'image' }, sources({ byKind: { image }, sweep }));

    expect(record).toHaveBeenCalledWith('https://cdn/image-url', expect.any(Function));
  });

  // Nothing can be swept that the host cannot delete, and a host that never
  // opted into deletion must not see an error for it either.
  it('records nothing when the uploader cannot delete, and sweeping still does not throw', async () => {
    const record = vi.spyOn(sweep, 'record');
    const image = uploaderWith('image');
    const file = new File(['x'], 'cover.png', { type: 'image/png' });

    await uploadAssetFile(file, { kind: 'image' }, sources({ byKind: { image }, sweep }));

    expect(record).not.toHaveBeenCalled();
    await expect(sweep.sweep(EMPTY_DOCUMENT)).resolves.toBeUndefined();
  });

  // An editor saving through its own `onSave` never reports whether the write
  // landed, so no moment exists at which an asset is known abandoned. It gets
  // no candidate set at all, and recording has to fall away with it.
  it('records nothing when the editor does not save through persistence', async () => {
    const image = deletableUploader('image');
    const file = new File(['x'], 'cover.png', { type: 'image/png' });

    const asset = await uploadAssetFile(file, { kind: 'image' }, sources({ byKind: { image } }));

    await sweep.sweep(EMPTY_DOCUMENT);

    expect(asset.url).toBe('https://cdn/image-file');
    expect(image.delete).not.toHaveBeenCalled();
  });

  it('records nothing for the blob fallback, which no host stored', async () => {
    const record = vi.spyOn(sweep, 'record');

    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');

    await uploadAssetFile(new File(['x'], 'a.png'), { kind: 'image' }, sources());
    await uploadAssetUrl('https://third-party/art.png', { kind: 'image' }, sources());

    expect(record).not.toHaveBeenCalled();
  });
});
