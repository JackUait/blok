import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../../src/tools/image/compress', () => ({
  compressImage: vi.fn(async () => null),
}));

import type { AssetKind } from '../../../../types/tools/block-tool';
import type { UploadContext, UploadedAsset } from '../../../../types/configs/uploader';
import { Uploader } from '../../../../src/tools/image/uploader';
import { compressImage } from '../../../../src/tools/image/compress';

const compressImageMock = vi.mocked(compressImage);

type UploadMethod = 'uploadByFile' | 'uploadByUrl';

interface AssetsStub {
  uploadByFile: (file: File, ctx: UploadContext) => Promise<UploadedAsset>;
  uploadByUrl: (url: string, ctx: UploadContext) => Promise<UploadedAsset>;
  isConfigured: (kind: AssetKind, method?: UploadMethod) => boolean;
}

interface RecordedFile {
  file: File;
  ctx: UploadContext;
}

interface RecordedUrl {
  url: string;
  ctx: UploadContext;
}

interface AssetsHarness {
  api: AssetsStub;
  fileCalls: RecordedFile[];
  urlCalls: RecordedUrl[];
  uploadByFile: ReturnType<typeof vi.fn>;
  uploadByUrl: ReturnType<typeof vi.fn>;
  isConfigured: ReturnType<typeof vi.fn>;
}

/**
 * `isConfigured` answers by MIME-kind AND method, so a mutated argument
 * ('image' or 'uploadByFile' blanked out) flips the routing instead of
 * silently still returning true.
 */
function makeAssets(configured: { file?: boolean; url?: boolean } = {}): AssetsHarness {
  const fileCalls: RecordedFile[] = [];
  const urlCalls: RecordedUrl[] = [];
  const anyFile = configured.file === true;
  const anyUrl = configured.url === true;

  const uploadByFile = vi.fn((file: File, ctx: UploadContext): Promise<UploadedAsset> => {
    fileCalls.push({ file, ctx });

    return Promise.resolve({ url: 'https://assets/file.png' });
  });
  const uploadByUrl = vi.fn((url: string, ctx: UploadContext): Promise<UploadedAsset> => {
    urlCalls.push({ url, ctx });

    return Promise.resolve({ url: 'https://assets/url.png' });
  });
  const isConfigured = vi.fn((kind: AssetKind, method?: UploadMethod): boolean => {
    // Unrecognised arguments answer false: a mutated call site must change the
    // routing, not be waved through by a permissive stub.
    if (kind !== 'image') return false;
    if (method === 'uploadByFile') return anyFile;
    if (method === 'uploadByUrl') return anyUrl;

    return false;
  });

  return {
    api: { uploadByFile, uploadByUrl, isConfigured },
    fileCalls,
    urlCalls,
    uploadByFile,
    uploadByUrl,
    isConfigured,
  };
}

const PNG_FILE = (): File => new File([new Uint8Array(8)], 'orig.png', { type: 'image/png' });

/** Runs a data: URL through the public API and returns the File it became. */
async function fileFromDataUrl(dataUrl: string): Promise<File> {
  const harness = makeAssets({ file: true });
  // `types: ['*']` so the parsed MIME (whatever the mutants turn it into)
  // reaches the uploader instead of being rejected by validation first.
  const uploader = new Uploader({ types: ['*'] }, harness.api);

  await uploader.handleUrl(dataUrl);

  expect(harness.fileCalls).toHaveLength(1);

  return harness.fileCalls[0].file;
}

async function bytesOf(file: File): Promise<number[]> {
  return Array.from(new Uint8Array(await file.arrayBuffer()));
}

beforeEach(() => {
  vi.clearAllMocks();
  compressImageMock.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Uploader — data: URL → File (dataUrlToFile)', () => {
  it('decodes a base64 payload into the raw bytes, not the base64 text', async () => {
    // "QUI=" is base64 for the two bytes 0x41 0x42 ("AB"). Treating the
    // payload as text (or as percent-encoded) yields the ASCII of "QUI=".
    const file = await fileFromDataUrl('data:image/png;base64,QUI=');

    expect(await bytesOf(file)).toStrictEqual([65, 66]);
  });

  it('names the file after the MIME subtype and types it with the MIME', async () => {
    const file = await fileFromDataUrl('data:image/png;base64,QUI=');

    expect(file.name).toBe('pasted-image.png');
    expect(file.type).toBe('image/png');
  });

  it('treats a payload without ;base64 as percent-encoded text, not base64', async () => {
    // Payload is plain "ABCD": percent-decoding keeps those 4 byte values.
    const file = await fileFromDataUrl('data:image/png,ABCD');

    expect(await bytesOf(file)).toStrictEqual([65, 66, 67, 68]);
    expect(file.name).toBe('pasted-image.png');
    expect(file.type).toBe('image/png');
  });

  it('strips the +suffix from an XML-style subtype when building the extension', async () => {
    const file = await fileFromDataUrl('data:image/svg+xml,ABCD');

    expect(file.name).toBe('pasted-image.svg');
    expect(file.type).toBe('image/svg+xml');
    expect(await bytesOf(file)).toStrictEqual([65, 66, 67, 68]);
  });

  it('falls back to a .bin extension when the header carries no subtype', async () => {
    // No comma at all: header is truncated to "image", which has no "/".
    const file = await fileFromDataUrl('data:image/');

    expect(file.name).toBe('pasted-image.bin');
    expect(file.type).toBe('image');
    expect(await bytesOf(file)).toStrictEqual(Array.from('data:image/').map((ch) => ch.charCodeAt(0)));
  });
});

describe('Uploader — URL protocol validation', () => {
  it('accepts a plain http:// URL and returns it verbatim', async () => {
    await expect(new Uploader({}).handleUrl('http://example.com/a.png')).resolves.toStrictEqual({
      url: 'http://example.com/a.png',
    });
  });

  it('accepts an https:// URL and returns it verbatim', async () => {
    await expect(new Uploader({}).handleUrl('https://example.com/a.png')).resolves.toStrictEqual({
      url: 'https://example.com/a.png',
    });
  });

  it('rejects a non-http(s) scheme and reports the offending protocol', async () => {
    await expect(new Uploader({}).handleUrl('file:///tmp/a.png')).rejects.toMatchObject({
      code: 'INVALID_URL',
      detail: 'file:',
    });
  });
});

describe('Uploader — UNSUPPORTED_TYPE detail', () => {
  it('reports the rejected MIME type verbatim', async () => {
    const file = new File([new Uint8Array(4)], 'doc.pdf', { type: 'application/pdf' });

    await expect(new Uploader({}).handleFile(file)).rejects.toMatchObject({
      code: 'UNSUPPORTED_TYPE',
      detail: 'application/pdf',
    });
  });

  it('reports "unknown" for a file with no MIME type', async () => {
    const file = new File([new Uint8Array(4)], 'mystery', { type: '' });

    await expect(new Uploader({}).handleFile(file)).rejects.toMatchObject({
      code: 'UNSUPPORTED_TYPE',
      detail: 'unknown',
    });
  });
});

describe('Uploader — size ceiling is inclusive', () => {
  it('accepts a file whose size equals maxSize exactly', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:exact');
    const file = new File([new Uint8Array(10)], 'exact.png', { type: 'image/png' });

    await expect(new Uploader({ maxSize: 10 }).handleFile(file)).resolves.toStrictEqual({
      url: 'blob:exact',
      fileName: 'exact.png',
    });
  });

  it('rejects one byte past the ceiling', async () => {
    const file = new File([new Uint8Array(11)], 'over.png', { type: 'image/png' });

    await expect(new Uploader({ maxSize: 10 }).handleFile(file)).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
      detail: '11 > 10',
    });
  });
});

describe('Uploader — api.uploader routing', () => {
  it('handleUrl asks api.uploader first, with the asset kind and tool named', async () => {
    const harness = makeAssets({ url: true, file: true });
    const toolUploader = vi.fn(async () => ({ url: 'https://tool/url.png' }));

    await expect(new Uploader({ uploader: { uploadByUrl: toolUploader } }, harness.api)
      .handleUrl('https://orig/a.png')).resolves.toStrictEqual({ url: 'https://assets/url.png' });

    expect(harness.urlCalls).toStrictEqual([{
      url: 'https://orig/a.png',
      ctx: { kind: 'image', tool: 'image', onProgress: undefined },
    }]);
    expect(toolUploader).not.toHaveBeenCalled();
  });

  it('handleFile asks api.uploader first, with the asset kind and tool named', async () => {
    const harness = makeAssets({ file: true });
    const file = PNG_FILE();

    await expect(new Uploader({}, harness.api).handleFile(file))
      .resolves.toStrictEqual({ url: 'https://assets/file.png' });

    expect(harness.fileCalls).toStrictEqual([{
      file,
      ctx: { kind: 'image', tool: 'image', onProgress: undefined },
    }]);
  });

  it('handleFile forwards onProgress through to api.uploader', async () => {
    const harness = makeAssets({ file: true });
    const onProgress = vi.fn();

    await new Uploader({}, harness.api).handleFile(PNG_FILE(), { onProgress });

    expect(harness.fileCalls[0].ctx.onProgress).toBe(onProgress);
  });

  it('handleDataUrl prefers api.uploader over a tool-level uploadByUrl', async () => {
    const harness = makeAssets({ url: true });
    const toolUploader = vi.fn(async () => ({ url: 'https://tool/url.png' }));
    const onProgress = vi.fn();

    await expect(new Uploader({ uploader: { uploadByUrl: toolUploader } }, harness.api)
      .handleUrl('data:image/png;base64,QUI=', { onProgress }))
      .resolves.toStrictEqual({ url: 'https://assets/url.png' });

    expect(harness.urlCalls).toStrictEqual([{
      url: 'data:image/png;base64,QUI=',
      ctx: { kind: 'image', tool: 'image', onProgress },
    }]);
    expect(toolUploader).not.toHaveBeenCalled();
  });

  it('handleDataUrl routes to the tool uploadByUrl when api.uploader is not configured for it', async () => {
    const harness = makeAssets({ file: true });
    const onProgress = vi.fn();
    const toolCalls: RecordedUrl[] = [];
    const toolUploader = (url: string, ctx: UploadContext): Promise<UploadedAsset> => {
      toolCalls.push({ url, ctx });

      return Promise.resolve({ url: 'https://tool/url.png' });
    };

    await expect(new Uploader({ uploader: { uploadByUrl: toolUploader } }, harness.api)
      .handleUrl('data:image/png;base64,QUI=', { onProgress }))
      .resolves.toStrictEqual({ url: 'https://tool/url.png' });

    expect(toolCalls).toStrictEqual([{
      url: 'data:image/png;base64,QUI=',
      ctx: { onProgress },
    }]);
    expect(harness.uploadByFile).not.toHaveBeenCalled();
  });

  it('handleDataUrl falls back to the file path when api.uploader only serves files', async () => {
    const harness = makeAssets({ file: true });

    await expect(new Uploader({}, harness.api).handleUrl('data:image/png;base64,QUI='))
      .resolves.toStrictEqual({ url: 'https://assets/file.png' });

    expect(harness.fileCalls[0].file.name).toBe('pasted-image.png');
    expect(harness.fileCalls[0].ctx).toStrictEqual({
      kind: 'image',
      tool: 'image',
      onProgress: undefined,
    });
    expect(harness.uploadByUrl).not.toHaveBeenCalled();
  });

  it('handleDataUrl routes to the api uploadByUrl when no tool uploader exists at all', async () => {
    const harness = makeAssets({ url: true });
    const onProgress = vi.fn();

    await expect(new Uploader({}, harness.api).handleUrl('data:image/png;base64,QUI=', { onProgress }))
      .resolves.toStrictEqual({ url: 'https://assets/url.png' });

    expect(harness.urlCalls).toStrictEqual([{
      url: 'data:image/png;base64,QUI=',
      ctx: { kind: 'image', tool: 'image', onProgress },
    }]);
    expect(harness.uploadByFile).not.toHaveBeenCalled();
  });

  it('handleUrl leaves the URL alone when api.uploader serves neither method', async () => {
    const harness = makeAssets();

    await expect(new Uploader({}, harness.api).handleUrl('https://orig/a.png'))
      .resolves.toStrictEqual({ url: 'https://orig/a.png' });
    expect(harness.isConfigured).toHaveBeenCalledWith('image', 'uploadByUrl');
  });

  it('handleFile leaves the file alone when api.uploader serves neither method', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:none');
    const harness = makeAssets();
    const file = PNG_FILE();

    await expect(new Uploader({}, harness.api).handleFile(file))
      .resolves.toStrictEqual({ url: 'blob:none', fileName: 'orig.png' });
    expect(harness.isConfigured).toHaveBeenCalledWith('image', 'uploadByFile');
  });
});
