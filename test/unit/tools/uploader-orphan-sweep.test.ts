/**
 * A tool-level `config.uploader` must not opt the tool out of asset cleanup.
 *
 * `api.uploader` is the only route into the orphan sweep: it records every
 * asset an editing session stored so a later save can delete the ones the
 * document abandoned. A media tool that calls `this.config.uploader` directly
 * never reaches it, so its candidate set stays empty, every post-save sweep
 * no-ops, and abandoned uploads stay in the host's store forever — while
 * `types/configs/uploader.d.ts` promises cleanup with no tool-level caveat.
 *
 * Routing through `api.uploader` runs the SAME uploader: the resolver files a
 * tool's own uploader under the kind it owns and gives it precedence over the
 * editor-level one. These tests drive the real resolver and the real sweep, so
 * they fail if that precedence ever changes.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

vi.mock('../../../src/tools/image/compress', () => ({
  compressImage: vi.fn(async () => null),
}));

import type { AssetKind } from '../../../types/tools/block-tool';
import type { BlokUploader, UploadContext } from '../../../types/configs/uploader';
import type { OutputData } from '../../../types';
import {
  collectAssetUploaderSources,
  hasAssetUploader,
  uploadAssetFile,
  uploadAssetUrl,
} from '../../../src/components/utils/asset-uploader';
import { createOrphanSweep, type OrphanSweep } from '../../../src/components/utils/orphan-sweep';
import { Uploader as ImageUploader } from '../../../src/tools/image/uploader';
import { Uploader as AudioUploader } from '../../../src/tools/audio/uploader';
import { Uploader as VideoUploader } from '../../../src/tools/video/uploader';
import { Uploader as FileUploader } from '../../../src/tools/file/uploader';

const STORED = 'https://cdn.example/uploads/a1?X-Amz-Signature=abc&X-Amz-Date=1';

const EMPTY_DOCUMENT: OutputData = { time: 0,
  version: '1',
  blocks: [] };

const makeFile = (name: string, type: string): File =>
  new File([new Uint8Array(10)], name, { type });

/**
 * The editor's asset uploader, assembled exactly the way `UploaderAPI.methods`
 * assembles it — a mock would prove nothing about the routing under test.
 * @param kind - the kind the tool under test owns
 * @param toolUploader - the uploader the host put on that tool's config
 * @param editorUploader - the editor-level `config.uploader`
 * @param sweep - this editor's candidate set
 */
const editorAssets = (
  kind: AssetKind,
  toolUploader: BlokUploader,
  editorUploader: BlokUploader,
  sweep: OrphanSweep
) => {
  const sources = collectAssetUploaderSources(
    [ { assetKind: kind,
      settings: { uploader: toolUploader } } ],
    editorUploader,
    sweep
  );

  return {
    uploadByFile: (file: File, ctx: UploadContext) => uploadAssetFile(file, ctx, sources),
    uploadByUrl: (url: string, ctx: UploadContext) => uploadAssetUrl(url, ctx, sources),
    isConfigured: (assetKind: AssetKind, method?: 'uploadByFile' | 'uploadByUrl') =>
      hasAssetUploader(assetKind, sources, method),
  };
};

describe('a tool-level uploader still records for the orphan sweep', () => {
  let sweep: OrphanSweep;
  let deleteAsset: Mock<DeleteAsset>;

  beforeEach(() => {
    vi.clearAllMocks();
    sweep = createOrphanSweep();
    deleteAsset = vi.fn<DeleteAsset>().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sweeps a file the image tool uploaded through its own uploader', async () => {
    const uploadByFile = vi.fn().mockResolvedValue({ url: STORED });
    const tool = { uploadByFile };
    const assets = editorAssets('image', tool, { delete: deleteAsset }, sweep);

    await expect(new ImageUploader({ uploader: tool }, assets).handleFile(makeFile('a.png', 'image/png')))
      .resolves.toMatchObject({ url: STORED });

    // The tool's own uploader still ran: routing changes who records, not who stores.
    expect(uploadByFile).toHaveBeenCalledTimes(1);

    await sweep.sweep(EMPTY_DOCUMENT);

    expect(deleteAsset).toHaveBeenCalledWith(STORED, { kind: 'image',
      tool: 'image' });
  });

  it('sweeps an image the tool re-hosted from a URL', async () => {
    const uploadByUrl = vi.fn().mockResolvedValue({ url: STORED });
    const tool = { uploadByUrl };
    const assets = editorAssets('image', tool, { delete: deleteAsset }, sweep);

    await expect(new ImageUploader({ uploader: tool }, assets).handleUrl('https://third-party/art.png'))
      .resolves.toMatchObject({ url: STORED });

    await sweep.sweep(EMPTY_DOCUMENT);

    expect(deleteAsset).toHaveBeenCalledWith(STORED, { kind: 'image',
      tool: 'image' });
  });

  it('sweeps a pasted data: URL the tool re-hosted', async () => {
    const uploadByUrl = vi.fn().mockResolvedValue({ url: STORED });
    const tool = { uploadByUrl };
    const assets = editorAssets('image', tool, { delete: deleteAsset }, sweep);

    await expect(new ImageUploader({ uploader: tool }, assets)
      .handleUrl('data:image/png;base64,aGk='))
      .resolves.toMatchObject({ url: STORED });

    await sweep.sweep(EMPTY_DOCUMENT);

    expect(deleteAsset).toHaveBeenCalledWith(STORED, { kind: 'image',
      tool: 'image' });
  });

  it('sweeps a file the audio tool uploaded through its own uploader', async () => {
    const tool = { uploadByFile: vi.fn().mockResolvedValue({ url: STORED }) };
    const assets = editorAssets('audio', tool, { delete: deleteAsset }, sweep);

    await expect(new AudioUploader({ uploader: tool }, assets).handleFile(makeFile('a.mp3', 'audio/mpeg')))
      .resolves.toMatchObject({ url: STORED });

    await sweep.sweep(EMPTY_DOCUMENT);

    expect(deleteAsset).toHaveBeenCalledWith(STORED, { kind: 'audio',
      tool: 'audio' });
  });

  it('sweeps an audio track the tool re-hosted from a URL', async () => {
    const tool = { uploadByUrl: vi.fn().mockResolvedValue({ url: STORED }) };
    const assets = editorAssets('audio', tool, { delete: deleteAsset }, sweep);

    await expect(new AudioUploader({ uploader: tool }, assets).handleUrl('https://third-party/track.mp3'))
      .resolves.toMatchObject({ url: STORED });

    await sweep.sweep(EMPTY_DOCUMENT);

    expect(deleteAsset).toHaveBeenCalledWith(STORED, { kind: 'audio',
      tool: 'audio' });
  });

  it('sweeps a file the video tool uploaded through its own uploader', async () => {
    const tool = { uploadByFile: vi.fn().mockResolvedValue({ url: STORED }) };
    const assets = editorAssets('video', tool, { delete: deleteAsset }, sweep);

    await expect(new VideoUploader({ uploader: tool }, assets).handleFile(makeFile('a.mp4', 'video/mp4')))
      .resolves.toMatchObject({ url: STORED });

    await sweep.sweep(EMPTY_DOCUMENT);

    expect(deleteAsset).toHaveBeenCalledWith(STORED, { kind: 'video',
      tool: 'video' });
  });

  it('sweeps a video the tool re-hosted from a URL', async () => {
    const tool = { uploadByUrl: vi.fn().mockResolvedValue({ url: STORED }) };
    const assets = editorAssets('video', tool, { delete: deleteAsset }, sweep);

    await expect(new VideoUploader({ uploader: tool }, assets).handleUrl('https://third-party/clip.mp4'))
      .resolves.toMatchObject({ url: STORED });

    await sweep.sweep(EMPTY_DOCUMENT);

    expect(deleteAsset).toHaveBeenCalledWith(STORED, { kind: 'video',
      tool: 'video' });
  });

  it('sweeps a file the file tool uploaded through its own uploader', async () => {
    const tool = { uploadByFile: vi.fn().mockResolvedValue({ url: STORED }) };
    const assets = editorAssets('file', tool, { delete: deleteAsset }, sweep);

    await expect(new FileUploader({ uploader: tool }, assets).handleFile(makeFile('a.pdf', 'application/pdf')))
      .resolves.toMatchObject({ url: STORED });

    await sweep.sweep(EMPTY_DOCUMENT);

    expect(deleteAsset).toHaveBeenCalledWith(STORED, { kind: 'file',
      tool: 'file' });
  });

  it('sweeps a file the file tool re-hosted from a URL', async () => {
    const tool = { uploadByUrl: vi.fn().mockResolvedValue({ url: STORED }) };
    const assets = editorAssets('file', tool, { delete: deleteAsset }, sweep);

    await expect(new FileUploader({ uploader: tool }, assets).handleUrl('https://third-party/doc.pdf'))
      .resolves.toMatchObject({ url: STORED });

    await sweep.sweep(EMPTY_DOCUMENT);

    expect(deleteAsset).toHaveBeenCalledWith(STORED, { kind: 'file',
      tool: 'file' });
  });

  // A tool built without the editor API (standalone use, older embeddings) has
  // nothing to route through, so its own uploader has to keep working.
  it('still calls the tool uploader directly when the tool has no editor API', async () => {
    const uploadByFile = vi.fn().mockResolvedValue({ url: STORED });

    await expect(new ImageUploader({ uploader: { uploadByFile } }).handleFile(makeFile('a.png', 'image/png')))
      .resolves.toMatchObject({ url: STORED });
    expect(uploadByFile).toHaveBeenCalledTimes(1);
  });
});
