import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mb = vi.hoisted(() => {
  const state = {
    isValid: true,
    discarded: [] as unknown[],
    duration: 5,
    buffer: new ArrayBuffer(8) as ArrayBuffer | null,
    mime: 'video/webm; codecs="vp09.00.10.08, opus"',
    executeError: null as Error | null,
    progress: [] as number[],
    initOptions: [] as Array<Record<string, unknown>>,
    formats: [] as string[],
    disposed: 0,
    cancelled: 0,
    videoCodec: 'vp09.00.10.08' as string | null,
    width: 320,
    height: 240,
  };

  class BufferTarget {
    public buffer: ArrayBuffer | null = null;
  }
  class Mp4OutputFormat {
    public readonly kind = 'mp4';
  }
  class WebMOutputFormat {
    public readonly kind = 'webm';
  }
  class BlobSource {
    constructor(public blob: Blob) {}
  }
  class Input {
    constructor(public options: unknown) {}
    public async computeDuration(): Promise<number> {
      return state.duration;
    }
    public dispose(): void {
      state.disposed += 1;
    }
  }
  class Output {
    constructor(public options: { format: { kind: string }; target: BufferTarget }) {
      state.formats.push(options.format.kind);
    }
    public get target(): BufferTarget {
      return this.options.target;
    }
    public async getMimeType(): Promise<string> {
      return state.mime;
    }
  }
  class Quality {
    constructor(public level: string) {}
  }
  const videoTrack = {
    getCodecParameterString: async (): Promise<string | null> => state.videoCodec,
    getDisplayWidth: async (): Promise<number> => state.width,
    getDisplayHeight: async (): Promise<number> => state.height,
  };
  const Conversion = {
    init: async (options: Record<string, unknown> & { output: Output }) => {
      // Mediabunny calls a per-track function with each input track.
      const video = typeof options.video === 'function'
        ? await (options.video as (track: typeof videoTrack) => unknown)(videoTrack)
        : options.video;

      state.initOptions.push({ ...options, video });
      const conversion = {
        isValid: state.isValid,
        discardedTracks: state.discarded,
        onProgress: undefined as undefined | ((p: number) => void),
        execute: async () => {
          if (state.executeError) throw state.executeError;
          conversion.onProgress?.(0.5);
          conversion.onProgress?.(1);
          const target = options.output.target;

          target.buffer = state.buffer;
        },
        cancel: async () => {
          state.cancelled += 1;
        },
      };

      return conversion;
    },
  };

  return {
    state,
    module: { ALL_FORMATS: ['all'], Quality, BufferTarget, Mp4OutputFormat, WebMOutputFormat, BlobSource, Input, Output, Conversion },
  };
});

import { produceVideoVariant } from '../../../../src/components/media-variants/video-variants';

const clip = (): File => new File([new Uint8Array(16)], 'clip.mov', { type: 'video/quicktime' });
const opts = { maxTranscodeDuration: 600, load: async () => mb.module };

describe('produceVideoVariant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mb.state, {
      isValid: true,
      discarded: [],
      duration: 5,
      buffer: new ArrayBuffer(8),
      mime: 'video/webm; codecs="vp09.00.10.08, opus"',
      executeError: null,
      progress: [],
      initOptions: [],
      formats: [],
      disposed: 0,
      cancelled: 0,
      videoCodec: 'vp09.00.10.08',
      width: 320,
      height: 240,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('makes an MP4 with H.264 and AAC, leaving quality unset so a fitting track is copied', async () => {
    mb.state.mime = 'video/mp4; codecs="avc1.64001f, mp4a.40.2"';

    const out = await produceVideoVariant(clip(), 'mp4', opts);

    expect(mb.state.formats).toEqual(['mp4']);
    expect(mb.state.initOptions[0]).toMatchObject({
      video: { codec: 'avc' },
      audio: { codec: 'aac' },
    });
    // Any quality makes Mediabunny re-encode a track it could copy.
    expect(mb.state.initOptions[0].video).not.toHaveProperty('quality');
    expect(mb.state.initOptions[0].audio).not.toHaveProperty('quality');
    expect(mb.state.initOptions[0].video).not.toHaveProperty('forceTranscode');
    expect(mb.state.initOptions[0]).not.toHaveProperty('copy');
    expect(out?.mimeType).toBe('video/mp4; codecs="avc1.64001f, mp4a.40.2"');
    expect(out?.file.type).toBe(out?.mimeType);
    expect(out?.file.size).toBe(8);
  });

  it('makes WebM with VP9 for webm and with AV1 for av1, both with Opus', async () => {
    await produceVideoVariant(clip(), 'webm', opts);
    await produceVideoVariant(clip(), 'av1', opts);

    expect(mb.state.formats).toEqual(['webm', 'webm']);
    expect(mb.state.initOptions.map((o) => [(o.video as { codec: string }).codec, (o.audio as { codec: string }).codec]))
      .toEqual([['vp9', 'opus'], ['av1', 'opus']]);
  });

  it('gives up when a track would be dropped, so a silent video is never kept', async () => {
    mb.state.discarded = [{ reason: 'no_encodable_target_codec' }];

    expect(await produceVideoVariant(clip(), 'mp4', opts)).toBeNull();
  });

  it('gives up on an invalid conversion, a failed run or an empty result', async () => {
    mb.state.isValid = false;
    expect(await produceVideoVariant(clip(), 'mp4', opts)).toBeNull();

    mb.state.isValid = true;
    mb.state.executeError = new Error('encoder crashed');
    expect(await produceVideoVariant(clip(), 'mp4', opts)).toBeNull();

    mb.state.executeError = null;
    mb.state.buffer = null;
    expect(await produceVideoVariant(clip(), 'mp4', opts)).toBeNull();
  });

  it('only copies a video longer than the cap, without a quality that would force a re-encode', async () => {
    mb.state.duration = 601;

    await produceVideoVariant(clip(), 'webm', opts);

    expect(mb.state.initOptions[0]).toMatchObject({ copy: { mode: 'forced' } });
    expect(mb.state.initOptions[0].video).not.toHaveProperty('quality');
    expect(mb.state.initOptions[0].audio).not.toHaveProperty('quality');
  });

  it.each([
    ['H.264 Baseline', 'avc1.42e01e'],
    ['H.264 Main', 'avc1.4d401f'],
    ['H.264 High', 'avc1.64000d'],
    ['VP9 profile 0', 'vp09.00.20.08.01.02.02.02.00'],
    ['AV1 8-bit', 'av01.0.04M.08'],
  ])('lets %s be copied', async (_name, codec) => {
    mb.state.videoCodec = codec;

    await produceVideoVariant(clip(), 'webm', opts);

    expect(mb.state.initOptions[0].video).not.toHaveProperty('forceTranscode');
  });

  it.each([
    ['H.264 High 10', 'avc1.6e000d'],
    ['H.264 High 4:4:4', 'avc1.f4000d'],
    ['VP9 profile 1', 'vp09.01.10.08.03.01.13.00.01'],
    ['VP9 profile 2', 'vp09.02.10.10'],
    ['AV1 10-bit', 'av01.0.04M.10'],
    ['an unknown codec', null],
  ])('re-encodes %s, which not every browser plays', async (_name, codec) => {
    mb.state.videoCodec = codec;

    await produceVideoVariant(clip(), 'webm', opts);

    expect(mb.state.initOptions[0].video).toMatchObject({ codec: 'vp9', forceTranscode: true });
  });

  it('asks for an even size when H.264 must be encoded from an odd-size video', async () => {
    Object.assign(mb.state, { videoCodec: 'vp09.01.10.08', width: 321, height: 241 });

    await produceVideoVariant(clip(), 'mp4', opts);
    expect(mb.state.initOptions[0].video).toMatchObject({ codec: 'avc', width: 321 });

    Object.assign(mb.state, { videoCodec: 'vp09.00.10.08', width: 320, height: 241 });
    await produceVideoVariant(clip(), 'mp4', opts);
    expect(mb.state.initOptions[1].video).toMatchObject({ codec: 'avc', width: 320 });
  });

  it('keeps the size when it is even, when the target is not H.264, or when H.264 can be copied', async () => {
    await produceVideoVariant(clip(), 'mp4', opts);

    Object.assign(mb.state, { videoCodec: 'vp09.01.10.08', width: 321, height: 241 });
    await produceVideoVariant(clip(), 'webm', opts);

    Object.assign(mb.state, { videoCodec: 'avc1.64000d', width: 321, height: 241 });
    await produceVideoVariant(clip(), 'mp4', opts);

    expect(mb.state.initOptions.map((o) => o.video)).toEqual([
      expect.not.objectContaining({ width: expect.anything() }),
      expect.not.objectContaining({ width: expect.anything() }),
      expect.not.objectContaining({ width: expect.anything() }),
    ]);
  });

  it('reports progress and frees the input every time', async () => {
    const seen: number[] = [];

    await produceVideoVariant(clip(), 'webm', { ...opts, onProgress: (p) => seen.push(p) });
    mb.state.executeError = new Error('x');
    await produceVideoVariant(clip(), 'webm', opts);

    expect(seen).toEqual([0.5, 1]);
    expect(mb.state.disposed).toBe(2);
  });

  it('cancels and returns nothing when the signal aborts', async () => {
    const controller = new AbortController();

    controller.abort();

    expect(await produceVideoVariant(clip(), 'webm', { ...opts, signal: controller.signal })).toBeNull();
    expect(mb.state.cancelled).toBe(1);
  });

  it('gives up when the host loader fails or returns something else', async () => {
    expect(await produceVideoVariant(clip(), 'webm', { ...opts, load: async () => {
      throw new Error('not installed');
    } })).toBeNull();
    expect(await produceVideoVariant(clip(), 'webm', { ...opts, load: async () => ({}) })).toBeNull();
  });
});
