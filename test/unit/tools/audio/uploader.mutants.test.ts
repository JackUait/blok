import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioUploadError, Uploader } from '../../../../src/tools/audio/uploader';
import type { AudioConfig, AudioUploadContext } from '../../../../types/tools/audio';
import type { Uploader as AssetUploaderApi } from '../../../../types/api/uploader';
import type { UploadedAsset, UploadContext } from '../../../../types/configs/uploader';
import type { AssetKind } from '../../../../types/tools/block-tool';

type IsConfigured = (kind: AssetKind, method?: 'uploadByFile' | 'uploadByUrl') => boolean;
type AssetFileFn = (file: File, ctx: UploadContext) => Promise<UploadedAsset>;
type AssetUrlFn = (url: string, ctx: UploadContext) => Promise<UploadedAsset>;
type ToolFileFn = (file: File, ctx?: AudioUploadContext) => Promise<{ url: string; fileName?: string }>;
type ToolUrlFn = (url: string, ctx?: AudioUploadContext) => Promise<{ url: string }>;

const mp3 = (size: number): File => new File([new Uint8Array(size)], 'song.mp3', { type: 'audio/mpeg' });

const DRIVE = 'https://drive.google.com/file/d/1kEpLxTdbrbEFMCUNSIrMkxCixC20ELrM/view';
const DRIVE_DIRECT =
  'https://drive.usercontent.google.com/download?id=1kEpLxTdbrbEFMCUNSIrMkxCixC20ELrM&export=download&confirm=t';
const DROPBOX = 'https://www.dropbox.com/s/abc/song.mp3?dl=0';
const DROPBOX_DIRECT = 'https://dl.dropboxusercontent.com/s/abc/song.mp3';

/**
 * Real predicate, not `() => true`: a mutant that blanks either argument
 * literal makes it answer false, which the routing tests then observe.
 */
const only = (method: 'uploadByFile' | 'uploadByUrl'): IsConfigured =>
  (kind, asked) => kind === 'audio' && asked === method;

const makeAssets = (configured: IsConfigured) => {
  const uploadByFile = vi.fn<AssetFileFn>(async () => ({ url: 'https://cdn/editor-file' }));
  const uploadByUrl = vi.fn<AssetUrlFn>(async () => ({ url: 'https://cdn/editor-url' }));
  const isConfigured = vi.fn<IsConfigured>(configured);
  const api: AssetUploaderApi = { uploadByFile, uploadByUrl, isConfigured };

  return { api, uploadByFile, uploadByUrl, isConfigured };
};

/** Await a rejection and return the error, failing loudly on a resolve or a foreign error type. */
async function rejection(promise: Promise<unknown>): Promise<AudioUploadError> {
  let resolved = false;

  try {
    await promise;
    resolved = true;
  } catch (error) {
    if (error instanceof AudioUploadError) return error;
    throw error;
  }
  if (resolved) throw new Error('expected AudioUploadError, but the promise resolved');
  throw new Error('unreachable');
}

describe('uploader.mutants — URL validation', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('rejects an unparseable URL with INVALID_URL and the raw text as the detail', async () => {
    // Kills the emptied `if (!parsed) {}` block and the `!parsed` -> false
    // condition: both drop the guard and reach `parsed.protocol` on null.
    // Kills 'INVALID_URL' -> '': the code stops matching.
    const error = await rejection(new Uploader({}).handleUrl('not a url'));

    expect(error.code).toBe('INVALID_URL');
    expect(error.detail).toBe('not a url');
  });

  it('builds an AudioUploadError carrying the class name and the "code: detail" message', async () => {
    // Kills `'AudioUploadError'` -> '' (name) and the `${code}: ${detail}`
    // template -> `` (message collapses to the bare code).
    const error = await rejection(new Uploader({}).handleUrl('ftp://x/y.mp3'));

    expect(error.name).toBe('AudioUploadError');
    expect(error.message).toBe('INVALID_URL: ftp:');
    expect(error.code).toBe('INVALID_URL');
    expect(error.detail).toBe('ftp:');
  });

  it('treats http and https as the only valid protocols', async () => {
    // Kills `parsed.protocol !== 'http:'` -> '': an http URL then fails the
    // first conjunct and is rejected. Kills the whole condition -> true, which
    // rejects every URL.
    const uploader = new Uploader({});

    await expect(uploader.handleUrl('http://x/y.mp3')).resolves.toStrictEqual({ url: 'http://x/y.mp3' });
    await expect(uploader.handleUrl('https://x/y.mp3')).resolves.toStrictEqual({ url: 'https://x/y.mp3' });
  });

  it('accepts a file whose size equals maxSize exactly (the ceiling is inclusive)', async () => {
    // Kills `file.size > maxSize` -> `>=`: at the exact ceiling the original
    // still uploads, the mutant rejects.
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:at-limit');

    await expect(new Uploader({ maxSize: 1024 }).handleFile(mp3(1024))).resolves.toStrictEqual({
      url: 'blob:at-limit',
      fileName: 'song.mp3',
    });
  });

  it('reports the file size and the ceiling in the FILE_TOO_LARGE message', async () => {
    // Kills the `${file.size} > ${maxSize}` template -> ``: the detail goes
    // empty and the message collapses to the bare code.
    await expect(new Uploader({ maxSize: 64 }).handleFile(mp3(65))).rejects.toThrowError(
      new AudioUploadError('FILE_TOO_LARGE', '65 > 64'),
    );
  });
});

describe('uploader.mutants — routing to the editor-level uploader', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('uploads a proxy-only share link when the editor uploader answers (audio, uploadByUrl)', async () => {
    // Kills either argument literal of the `canRehost` probe: isConfigured('',
    // 'uploadByUrl') / ('audio', '') both answer false, so the Drive link is
    // refused as GOOGLE_DRIVE_NEEDS_UPLOADER. Kills the same mutation on the
    // routing check below, which then skips the editor uploader entirely.
    const assets = makeAssets(only('uploadByUrl'));
    const uploader = new Uploader({}, assets.api);

    await expect(uploader.handleUrl(DRIVE)).resolves.toStrictEqual({ url: 'https://cdn/editor-url' });
    expect(assets.uploadByUrl).toHaveBeenCalledWith(DRIVE_DIRECT, expect.anything());
  });

  it('hands the editor uploader the direct-content URL and the full audio context', async () => {
    // Kills `share?.url ?? raw` -> `share?.url && raw`: the mutant sends the
    // share page URL instead of the direct one. Kills the context object
    // literal -> {}: the kind/tool/progress routing data is dropped.
    const assets = makeAssets(only('uploadByUrl'));
    const uploader = new Uploader({}, assets.api);
    const progress = vi.fn();

    await expect(uploader.handleUrl(DROPBOX, { onProgress: progress })).resolves.toStrictEqual({
      url: 'https://cdn/editor-url',
    });
    expect(assets.uploadByUrl).toHaveBeenCalledWith(DROPBOX_DIRECT, {
      kind: 'audio',
      tool: 'audio',
      onProgress: progress,
    });
  });

  it('routes a file through the editor uploader when it answers (audio, uploadByFile)', async () => {
    // Kills the 'uploadByFile' argument literal -> '': the editor uploader no
    // longer claims the file and the local blob fallback is used instead.
    const assets = makeAssets(only('uploadByFile'));
    const uploader = new Uploader({}, assets.api);
    const file = mp3(10);

    await expect(uploader.handleFile(file)).resolves.toStrictEqual({ url: 'https://cdn/editor-file' });
    expect(assets.uploadByFile).toHaveBeenCalledWith(file, {
      kind: 'audio',
      tool: 'audio',
      onProgress: undefined,
    });
  });
});

describe('uploader.mutants — routing to the tool-level uploader', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('keeps the tool uploader authoritative for a URL that is no share link', async () => {
    // Kills `share?.url` -> `share.url`: with no recognized share link the
    // mutant dereferences null and throws before the uploader is reached.
    // Kills the context object literal -> {}: the progress callback is lost.
    const uploadByUrl = vi.fn<ToolUrlFn>(async () => ({ url: 'https://cdn/tool-url' }));
    const uploader = new Uploader({ uploader: { uploadByUrl } });
    const progress = vi.fn();

    await expect(uploader.handleUrl('https://x/y.mp3', { onProgress: progress })).resolves.toStrictEqual({
      url: 'https://cdn/tool-url',
    });
    expect(uploadByUrl).toHaveBeenCalledWith('https://x/y.mp3', { onProgress: progress });
  });

  it('hands the tool uploader the file and its progress context', async () => {
    // Kills the file-branch context object literal -> {}: the progress
    // callback is lost.
    const uploadByFile = vi.fn<ToolFileFn>(async () => ({ url: 'https://cdn/tool-file' }));
    const uploader = new Uploader({ uploader: { uploadByFile } });
    const file = mp3(10);
    const progress = vi.fn();

    await expect(uploader.handleFile(file, { onProgress: progress })).resolves.toStrictEqual({
      url: 'https://cdn/tool-file',
    });
    expect(uploadByFile).toHaveBeenCalledWith(file, { onProgress: progress });
  });

  it('does not consult the editor uploader when only the tool declares one', async () => {
    // Pins the precedence the docblock promises: a tool-level uploader stays
    // authoritative, so the editor uploader is never asked.
    const assets = makeAssets(() => true);
    const uploadByFile = vi.fn<ToolFileFn>(async () => ({ url: 'https://cdn/tool-file' }));
    const config: AudioConfig = { uploader: { uploadByFile } };

    await expect(new Uploader(config, assets.api).handleFile(mp3(10))).resolves.toStrictEqual({
      url: 'https://cdn/editor-file',
    });
    expect(uploadByFile).not.toHaveBeenCalled();
  });
});
