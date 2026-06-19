import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// webm-muxer is dynamic-imported in the module under test; mock it.
vi.mock('webm-muxer', () => {
  class ArrayBufferTarget { buffer = new Uint8Array([1, 2, 3]).buffer; }
  class Muxer {
    constructor(public opts: unknown) {}
    addVideoChunk = vi.fn();
    finalize = vi.fn();
  }
  return { Muxer, ArrayBufferTarget };
});

import { convertGifToWebm } from '../../../../src/tools/image/gif-to-webm';

interface FakeFrame { displayWidth: number; displayHeight: number; duration: number; timestamp: number; close: () => void; }

const makeFrame = (): FakeFrame => ({
  displayWidth: 4, displayHeight: 4, duration: 100_000, timestamp: 0, close: vi.fn(),
});

const installWebCodecs = (frameCount: number, frames: FakeFrame[]): void => {
  class FakeImageDecoder {
    tracks = { ready: Promise.resolve(), selectedTrack: { frameCount } };
    constructor(public init: unknown) {}
    async decode({ frameIndex }: { frameIndex: number }): Promise<{ image: FakeFrame; complete: boolean }> {
      const image = makeFrame();
      frames.push(image);
      return { image, complete: true };
    }
    close = vi.fn();
  }
  class FakeVideoEncoder {
    static isConfigSupported = vi.fn(async (cfg: unknown) => ({ supported: true, config: cfg }));
    constructor(public init: { output: (c: unknown, m: unknown) => void; error: (e: unknown) => void }) {}
    configure = vi.fn();
    encode = vi.fn(() => { this.init.output({}, { decoderConfig: {} }); });
    flush = vi.fn(async () => undefined);
    close = vi.fn();
  }
  (globalThis as Record<string, unknown>).ImageDecoder = FakeImageDecoder;
  (globalThis as Record<string, unknown>).VideoEncoder = FakeVideoEncoder;
};

describe('convertGifToWebm', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).ImageDecoder;
    delete (globalThis as Record<string, unknown>).VideoEncoder;
    vi.restoreAllMocks();
  });

  it('returns null when WebCodecs is unavailable', async () => {
    expect(await convertGifToWebm(new ArrayBuffer(8))).toBeNull();
  });

  it('returns null for a single-frame (non-animated) GIF', async () => {
    installWebCodecs(1, []);
    expect(await convertGifToWebm(new ArrayBuffer(8))).toBeNull();
  });

  it('returns a webm Blob for an animated GIF and closes every decoded frame', async () => {
    const frames: FakeFrame[] = [];
    installWebCodecs(3, frames);
    const blob = await convertGifToWebm(new ArrayBuffer(8));
    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe('video/webm');
    expect(frames).toHaveLength(3);
    frames.forEach((f) => expect(f.close).toHaveBeenCalled());
  });

  it('returns null when encoding throws', async () => {
    installWebCodecs(3, []);
    (globalThis as Record<string, unknown>).VideoEncoder = class {
      static isConfigSupported = vi.fn(async () => ({ supported: false }));
      constructor() { /* unsupported */ }
    };
    expect(await convertGifToWebm(new ArrayBuffer(8))).toBeNull();
  });
});
