import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockAPI, BlockToolConstructorOptions } from '../../../../types';
import type { AudioConfig, AudioData } from '../../../../types/tools/audio';
import type * as CoverPickerModule from '../../../../src/tools/audio/cover-picker';
import { AudioTool } from '../../../../src/tools/audio';
import { resolveCover } from '../../../../src/tools/audio/metadata';

vi.mock('../../../../src/tools/audio/waveform', () => ({
  decodePeaks: vi.fn().mockResolvedValue(null),
  attachWaveform: vi.fn().mockReturnValue({ destroy: vi.fn() }),
}));

const coverPickerCalls: Array<{
  onFile: (f: File) => void;
  onUrl: (u: string) => void;
  handle: { close: ReturnType<typeof vi.fn>; setError: ReturnType<typeof vi.fn> };
}> = [];

vi.mock('../../../../src/tools/audio/cover-picker', async (importOriginal) => {
  const actual = await importOriginal<typeof CoverPickerModule>();

  return {
    ...actual,
    openCoverPicker: vi.fn((o: { onFile: (f: File) => void; onUrl: (u: string) => void }) => {
      const handle = { close: vi.fn(), setError: vi.fn() };

      coverPickerCalls.push({ onFile: o.onFile, onUrl: o.onUrl, handle });

      return handle;
    }),
  };
});

/** Stands in for the editor's asset-kind-routed uploader API. */
const createUploaderApi = (over: Partial<API['uploader']> = {}): API['uploader'] => ({
  uploadByFile: vi.fn(async (file: File) => ({ url: `https://cdn/${file.name}` })),
  uploadByUrl: vi.fn(async (url: string) => ({ url: `https://cdn/rehosted-${url.split('/').pop()}` })),
  isConfigured: vi.fn(() => true),
  ...over,
});

const createMockApi = (uploader: API['uploader']): API => ({
  styles: { block: 'blok-block' },
  i18n: {
    t: (k: string) => k,
    has: () => false,
  },
  uploader,
} as unknown as API);

const createMockBlock = (): BlockAPI => ({
  id: 'a1',
  name: 'audio',
  holder: document.createElement('div'),
  dispatchChange: vi.fn(),
} as unknown as BlockAPI);

const renderTool = (uploader: API['uploader'], config: AudioConfig = {}) => {
  const block = createMockBlock();
  const options: BlockToolConstructorOptions<AudioData, AudioConfig> = {
    data: { url: 'https://cdn/a.mp3' },
    config,
    api: createMockApi(uploader),
    block,
    readOnly: false,
  };
  const tool = new AudioTool(options);
  const root = tool.render();

  document.body.appendChild(root);

  return { tool, root, block };
};

const openPicker = (root: HTMLElement): void => {
  root.querySelector<HTMLButtonElement>('[data-role="audio-cover-change"]')!.click();
};

beforeEach(() => {
  vi.clearAllMocks();
  coverPickerCalls.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('audio cover art routes to the image pipeline', () => {
  it('uploads a picked cover file as an image asset, not an audio one', async () => {
    const uploader = createUploaderApi();
    const { root, tool } = renderTool(uploader);

    openPicker(root);
    const file = new File(['x'], 'cover.png', { type: 'image/png' });

    coverPickerCalls[0].onFile(file);

    await vi.waitFor(() => {
      expect(tool.save().coverUrl).toBe('https://cdn/cover.png');
    });
    expect(uploader.uploadByFile).toHaveBeenCalledWith(file, {
      kind: 'image',
      tool: 'audio',
    });
  });

  it('never posts the cover through the audio tool\'s own uploader', async () => {
    const audioUploadByFile = vi.fn();
    const uploader = createUploaderApi();
    const { root } = renderTool(uploader, { uploader: { uploadByFile: audioUploadByFile } });

    openPicker(root);
    coverPickerCalls[0].onFile(new File(['x'], 'cover.png', { type: 'image/png' }));

    await vi.waitFor(() => {
      expect(uploader.uploadByFile).toHaveBeenCalled();
    });
    expect(audioUploadByFile).not.toHaveBeenCalled();
  });

  it('re-hosts a cover supplied by URL, like the audio URL path does', async () => {
    const uploader = createUploaderApi();
    const { root, tool } = renderTool(uploader);

    openPicker(root);
    coverPickerCalls[0].onUrl('https://third-party.example/art.png');

    await vi.waitFor(() => {
      expect(tool.save().coverUrl).toBe('https://cdn/rehosted-art.png');
    });
    expect(uploader.uploadByUrl).toHaveBeenCalledWith('https://third-party.example/art.png', {
      kind: 'image',
      tool: 'audio',
    });
  });

  it('surfaces a failed cover URL re-host instead of storing a broken cover', async () => {
    const uploader = createUploaderApi({
      uploadByUrl: vi.fn().mockRejectedValue(new Error('403')),
    });
    const { root, tool } = renderTool(uploader);

    openPicker(root);
    coverPickerCalls[0].onUrl('https://third-party.example/art.png');

    await vi.waitFor(() => {
      expect(coverPickerCalls[0].handle.setError).toHaveBeenCalled();
    });
    expect(tool.save().coverUrl).toBeUndefined();
  });

  it('keeps working with no uploader configured (blob fallback)', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local');
    const uploader = createUploaderApi({
      uploadByFile: vi.fn(async (file: File) => ({ url: URL.createObjectURL(file) })),
      isConfigured: vi.fn(() => false),
    });
    const { root, tool } = renderTool(uploader);

    openPicker(root);
    coverPickerCalls[0].onFile(new File(['x'], 'cover.png', { type: 'image/png' }));

    await vi.waitFor(() => {
      expect(tool.save().coverUrl).toBe('blob:local');
    });
  });
});

describe('resolveCover (embedded ID3 artwork)', () => {
  const cover = {
    data: new Uint8Array([1, 2, 3]),
    mimeType: 'image/jpeg',
  };

  it('uploads embedded artwork as an image asset', async () => {
    const uploader = createUploaderApi();

    await expect(resolveCover(cover, uploader, 'audio')).resolves.toBe('https://cdn/cover.jpeg');
    expect(uploader.uploadByFile).toHaveBeenCalledWith(
      expect.any(File),
      { kind: 'image', tool: 'audio' }
    );
  });

  it('gives the extracted artwork a filename with an extension', async () => {
    const uploader = createUploaderApi();

    await resolveCover(cover, uploader, 'audio');

    const uploaded = (uploader.uploadByFile as ReturnType<typeof vi.fn>).mock.calls[0][0] as File;

    // Backends routinely derive content type and storage key from the filename;
    // an extensionless "cover" is rejected or stored unservable.
    expect(uploaded.name).toBe('cover.jpeg');
    expect(uploaded.type).toBe('image/jpeg');
  });

  it('propagates an upload failure rather than swallowing it', async () => {
    const uploader = createUploaderApi({
      uploadByFile: vi.fn().mockRejectedValue(new Error('415')),
    });

    await expect(resolveCover(cover, uploader, 'audio')).rejects.toThrow('415');
  });

  it('inlines small artwork as a data URL when no image uploader is configured', async () => {
    const uploader = createUploaderApi({ isConfigured: vi.fn(() => false) });

    await expect(resolveCover(cover, uploader, 'audio')).resolves.toMatch(/^data:image\/jpeg;base64,/);
    expect(uploader.uploadByFile).not.toHaveBeenCalled();
  });
});
