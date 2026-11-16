// @vitest-environment node
// Node, so mediabunny reads the output with Node's own Blob.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ALL_FORMATS, BufferSource, EncodedPacketSink, Input } from 'mediabunny';

import { convertGifToWebm } from '../../../../src/tools/image/gif-to-webm';

// A real VideoFrame's timestamp is getter-only; writing it throws in strict code.
class FakeFrame {
  displayWidth = 4;
  displayHeight = 4;
  close = vi.fn();
  // All white.
  copyTo = vi.fn(async (dest: Uint8Array, _opts?: { format: string }) => { dest.fill(255); });
  constructor(private readonly stamp: number, public duration: number) {}
  get timestamp(): number { return this.stamp; }
}

const makeFrame = (timestamp = 0, duration = 100_000): FakeFrame => new FakeFrame(timestamp, duration);

interface FrameInit {
  format: string;
  codedWidth: number;
  codedHeight: number;
  timestamp: number;
  duration: number;
  colorSpace: Record<string, unknown>;
}

interface Fakes { decoded: FakeFrame[]; copies: FakeFrame[]; encoded: FakeFrame[]; inits: Array<{ data: Uint8Array; init: FrameInit }> }

const installWebCodecs = (
  frameCount: number,
  fakes: Fakes = { decoded: [], copies: [], encoded: [], inits: [] },
  throwOnEncode = -1,
): Fakes => {
  class FakeImageDecoder {
    tracks = { ready: Promise.resolve(), selectedTrack: { frameCount } };
    constructor(public init: unknown) {}
    async decode(_opts: { frameIndex: number }): Promise<{ image: FakeFrame; complete: boolean }> {
      const image = makeFrame();
      fakes.decoded.push(image);
      return { image, complete: true };
    }
    close = vi.fn();
  }
  class FakeVideoEncoder {
    static isConfigSupported = vi.fn(async (cfg: unknown) => ({ supported: true, config: cfg }));
    constructor(public init: { output: (c: unknown, m: unknown) => void; error: (e: unknown) => void }) {}
    configure = vi.fn();
    encode = vi.fn((frame: FakeFrame, opts?: { keyFrame?: boolean }) => {
      if (fakes.encoded.length === throwOnEncode) throw new Error('encode failed');
      const payload = Uint8Array.of(fakes.encoded.length, 0xaa, 0xbb);

      fakes.encoded.push(frame);
      this.init.output({
        type: opts?.keyFrame === true ? 'key' : 'delta',
        timestamp: frame.timestamp,
        duration: frame.duration,
        byteLength: payload.length,
        copyTo: (dest: Uint8Array) => dest.set(payload),
      }, { decoderConfig: {} });
    });
    flush = vi.fn(async () => undefined);
    close = vi.fn();
  }
  class FakeVideoFrame {
    constructor(data: Uint8Array, init: FrameInit) {
      const copy = makeFrame(init.timestamp, init.duration);

      fakes.copies.push(copy);
      fakes.inits.push({ data, init });

      return copy;
    }
  }

  (globalThis as Record<string, unknown>).ImageDecoder = FakeImageDecoder;
  (globalThis as Record<string, unknown>).VideoEncoder = FakeVideoEncoder;
  (globalThis as Record<string, unknown>).VideoFrame = FakeVideoFrame;

  return fakes;
};

describe('convertGifToWebm', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).ImageDecoder;
    delete (globalThis as Record<string, unknown>).VideoEncoder;
    delete (globalThis as Record<string, unknown>).VideoFrame;
    vi.restoreAllMocks();
  });

  it('returns null when WebCodecs is unavailable', async () => {
    expect(await convertGifToWebm(new ArrayBuffer(8))).toBeNull();
  });

  it('returns null for a single-frame (non-animated) GIF', async () => {
    installWebCodecs(1);
    expect(await convertGifToWebm(new ArrayBuffer(8))).toBeNull();
  });

  it('returns a webm Blob for an animated GIF and closes every decoded frame', async () => {
    const fakes = installWebCodecs(3);
    const blob = await convertGifToWebm(new ArrayBuffer(8));
    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe('video/webm');
    expect(fakes.decoded).toHaveLength(3);
    [...fakes.decoded, ...fakes.copies].forEach((f) => expect(f.close).toHaveBeenCalled());
  });

  it('writes every encoded chunk into a WebM that keeps the GIF timing', async () => {
    installWebCodecs(3);
    const blob = await convertGifToWebm(new ArrayBuffer(8));

    if (!blob) throw new Error('no blob');

    const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(new Uint8Array(await blob.arrayBuffer())) });
    const track = await input.getPrimaryVideoTrack();

    if (!track) throw new Error('no video track');

    const packets = [];

    for await (const packet of new EncodedPacketSink(track).packets()) packets.push(packet);

    expect(packets.map((p) => [p.type, Math.round(p.timestamp * 1000), Array.from(p.data)])).toEqual([
      ['key', 0, [0, 0xaa, 0xbb]],
      ['delta', 100, [1, 0xaa, 0xbb]],
      ['delta', 200, [2, 0xaa, 0xbb]],
    ]);
    expect(await input.computeDuration()).toBeCloseTo(0.3, 6);
    expect(track.codec).toBe('vp9');
  });

  it('encodes re-stamped copies whose timestamps follow the GIF delays', async () => {
    const fakes = installWebCodecs(3);
    await convertGifToWebm(new ArrayBuffer(8));
    expect(fakes.encoded.map((f) => f.timestamp)).toEqual([0, 100_000, 200_000]);
    expect(fakes.encoded).toEqual(fakes.copies);
  });

  it('hands the encoder limited-range I420 frames, because it marks RGB frames as full range', async () => {
    const fakes = installWebCodecs(2);

    await convertGifToWebm(new ArrayBuffer(8));

    expect(fakes.decoded.map((f) => f.copyTo.mock.calls[0][1])).toEqual([{ format: 'RGBA' }, { format: 'RGBA' }]);
    expect(fakes.inits.map(({ init }) => init)).toEqual([0, 100_000].map((timestamp) => ({
      format: 'I420',
      codedWidth: 4,
      codedHeight: 4,
      timestamp,
      duration: 100_000,
      colorSpace: { matrix: 'bt709', primaries: 'bt709', transfer: 'bt709', fullRange: false },
    })));
    // 4×4 white: 16 luma samples at 235, then 4 + 4 chroma samples at 128.
    expect(Array.from(fakes.inits[0].data)).toEqual([...Array.from({ length: 16 }, () => 235), ...Array.from({ length: 8 }, () => 128)]);
  });

  it('closes a decoded frame whose encode throws', async () => {
    const fakes = installWebCodecs(3, undefined, 1);

    expect(await convertGifToWebm(new ArrayBuffer(8))).toBeNull();
    expect(fakes.decoded).toHaveLength(2);
    fakes.decoded.forEach((f) => expect(f.close).toHaveBeenCalled());
  });

  it('returns null when encoding throws', async () => {
    installWebCodecs(3);
    (globalThis as Record<string, unknown>).VideoEncoder = class {
      static isConfigSupported = vi.fn(async () => ({ supported: false }));
      constructor() { /* unsupported */ }
    };
    expect(await convertGifToWebm(new ArrayBuffer(8))).toBeNull();
  });
});
