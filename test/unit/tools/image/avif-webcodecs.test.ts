import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  encodeAvifWithVideoEncoder,
  pickSeqLevelIdx,
  qualityToQuantizer,
} from '../../../../src/tools/image/avif-webcodecs';

interface FakeBitmap { width: number; height: number; close: () => void; }

const makeBitmap = (width = 1920, height = 1080): FakeBitmap => ({ width, height, close: vi.fn() });

const td = new TextDecoder();

const readU32 = (data: Uint8Array, offset: number): number =>
  ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;

const findBox = (data: Uint8Array, type: string): number => {
  for (let i = 0; i + 8 <= data.length; i++) {
    if (td.decode(data.subarray(i + 4, i + 8)) === type && readU32(data, i) >= 8) return i;
  }

  return -1;
};

/** A canned "encoded chunk": temporal delimiter OBU + a fake frame OBU. */
const TEMPORAL_DELIMITER = [0b0001_0010, 0x00];
const FRAME_OBU = [0b0011_0010, 0x03, 0xaa, 0xbb, 0xcc];
const CHUNK_BYTES = Uint8Array.from([...TEMPORAL_DELIMITER, ...FRAME_OBU]);

/** State captured from the fakes so tests can assert on the encoder contract. */
let configuredWith: Record<string, unknown> | null;
let encodeOptions: Record<string, unknown> | null;
let supportedRequests: Array<Record<string, unknown>>;
let supported: boolean;
let reportedColorSpace: Record<string, unknown> | undefined;
let alpha: number;
let frameClosed: boolean;
let encoderClosed: boolean;
let failEncode: boolean;

const installWebCodecs = (): void => {
  class FakeVideoFrame {
    constructor(public source: unknown, public init: { timestamp: number }) {}
    close(): void { frameClosed = true; }
  }

  class FakeVideoEncoder {
    static async isConfigSupported(config: Record<string, unknown>): Promise<{ supported: boolean }> {
      supportedRequests.push(config);

      return { supported };
    }

    private readonly output: (chunk: unknown, meta: unknown) => void;
    private readonly onError: (err: unknown) => void;

    constructor(init: { output: (chunk: unknown, meta: unknown) => void; error: (err: unknown) => void }) {
      this.output = init.output;
      this.onError = init.error;
    }

    configure(config: Record<string, unknown>): void { configuredWith = config; }

    encode(_frame: unknown, options: Record<string, unknown>): void {
      encodeOptions = options;
      if (failEncode) {
        this.onError(new Error('encoder exploded'));

        return;
      }
      this.output(
        {
          type: 'key',
          byteLength: CHUNK_BYTES.length,
          copyTo: (dest: Uint8Array) => dest.set(CHUNK_BYTES),
        },
        { decoderConfig: { codec: 'av01', colorSpace: reportedColorSpace } },
      );
    }

    async flush(): Promise<void> {
      if (failEncode) throw new Error('encoder exploded');
    }

    close(): void { encoderClosed = true; }
  }

  class FakeOffscreenCanvas {
    constructor(public width: number, public height: number) {}
    getContext(): unknown {
      const canvas = this;

      return {
        drawImage: vi.fn(),
        getImageData(_x: number, _y: number, w: number, h: number): { data: Uint8ClampedArray } {
          void canvas;
          const data = new Uint8ClampedArray(w * h * 4);

          data.fill(200);
          for (let i = 3; i < data.length; i += 4) data[i] = alpha;

          return { data };
        },
      };
    }
  }

  const g = globalThis as Record<string, unknown>;

  g.VideoEncoder = FakeVideoEncoder;
  g.VideoFrame = FakeVideoFrame;
  g.OffscreenCanvas = FakeOffscreenCanvas;
};

describe('qualityToQuantizer', () => {
  it('maps canvas-style quality onto the AV1 quantizer range', () => {
    expect(qualityToQuantizer(1)).toBe(0);
    expect(qualityToQuantizer(0)).toBe(63);
    expect(qualityToQuantizer(0.92)).toBe(5);
  });

  it('clamps out-of-range values', () => {
    expect(qualityToQuantizer(2)).toBe(0);
    expect(qualityToQuantizer(-1)).toBe(63);
  });
});

describe('pickSeqLevelIdx', () => {
  it('picks the smallest AV1 level that fits the frame', () => {
    expect(pickSeqLevelIdx(1024, 100)).toBe(0); // level 2.0
    expect(pickSeqLevelIdx(1920, 1080)).toBe(8); // level 4.0
    expect(pickSeqLevelIdx(4096, 2176)).toBe(12); // level 5.0
    expect(pickSeqLevelIdx(8192, 4352)).toBe(16); // level 6.0
  });

  it('returns null for frames beyond level 6.0', () => {
    expect(pickSeqLevelIdx(17000, 4000)).toBeNull();
  });
});

describe('encodeAvifWithVideoEncoder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configuredWith = null;
    encodeOptions = null;
    supportedRequests = [];
    supported = true;
    reportedColorSpace = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };
    alpha = 255;
    frameClosed = false;
    encoderClosed = false;
    failEncode = false;
    installWebCodecs();
  });

  afterEach(() => {
    const g = globalThis as Record<string, unknown>;

    delete g.VideoEncoder;
    delete g.VideoFrame;
    delete g.OffscreenCanvas;
    vi.restoreAllMocks();
  });

  const encode = (
    bitmap: FakeBitmap = makeBitmap(),
    size = { width: 1920, height: 1080 },
    quality = 0.92,
  ): Promise<Blob | null> =>
    encodeAvifWithVideoEncoder(bitmap as unknown as ImageBitmap, size, quality);

  it('returns null when the browser has no VideoEncoder', async () => {
    delete (globalThis as Record<string, unknown>).VideoEncoder;
    expect(await encode()).toBeNull();
  });

  it('returns null when AV1 quantizer-mode encoding is not supported', async () => {
    supported = false;
    expect(await encode()).toBeNull();
  });

  it('returns null for frames larger than any supported AV1 level', async () => {
    expect(await encode(makeBitmap(9000, 5000), { width: 9000, height: 5000 })).toBeNull();
  });

  it('returns null when the image has transparency — a single-item AVIF has no alpha plane', async () => {
    alpha = 128;
    expect(await encode()).toBeNull();
  });

  it('returns null when the encoder errors', async () => {
    failEncode = true;
    expect(await encode()).toBeNull();
  });

  it('produces an AVIF blob whose mdat holds the chunk minus the temporal delimiter', async () => {
    const blob = await encode();

    expect(blob).not.toBeNull();
    if (!blob) return;
    expect(blob.type).toBe('image/avif');

    const file = new Uint8Array(await blob.arrayBuffer());

    expect(td.decode(file.subarray(4, 8))).toBe('ftyp');
    expect(td.decode(file.subarray(8, 12))).toBe('avif');

    const mdat = findBox(file, 'mdat');
    const payload = [...file.subarray(mdat + 8)];

    expect(payload).toEqual(FRAME_OBU);
  });

  it('requests a level-appropriate codec string in quantizer mode', async () => {
    await encode();

    expect(supportedRequests[0]?.codec).toBe('av01.0.08M.08');
    expect(supportedRequests[0]?.bitrateMode).toBe('quantizer');
    expect(configuredWith?.codec).toBe('av01.0.08M.08');
  });

  it('encodes a keyframe with the quantizer derived from quality', async () => {
    await encode(makeBitmap(), { width: 1920, height: 1080 }, 0.5);

    expect(encodeOptions?.keyFrame).toBe(true);
    expect((encodeOptions?.av1 as { quantizer: number }).quantizer).toBe(32);
  });

  it('mirrors the encoder-reported colour space into colr', async () => {
    reportedColorSpace = { primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'smpte170m', fullRange: true };
    const blob = await encode();

    expect(blob).not.toBeNull();
    if (!blob) return;
    const file = new Uint8Array(await blob.arrayBuffer());
    const colr = findBox(file, 'colr');

    expect((file[colr + 12] << 8) | file[colr + 13]).toBe(1); // bt709 primaries
    expect((file[colr + 14] << 8) | file[colr + 15]).toBe(13); // sRGB transfer
    expect((file[colr + 16] << 8) | file[colr + 17]).toBe(6); // bt601 matrix
    expect(file[colr + 18]).toBe(0x80); // full range
  });

  it('falls back to bt709 limited-range signalling when the encoder reports nothing', async () => {
    reportedColorSpace = undefined;
    const blob = await encode();

    expect(blob).not.toBeNull();
    if (!blob) return;
    const file = new Uint8Array(await blob.arrayBuffer());
    const colr = findBox(file, 'colr');

    expect((file[colr + 16] << 8) | file[colr + 17]).toBe(1); // bt709 matrix
    expect(file[colr + 18]).toBe(0x00); // limited range
  });

  it('closes the frame and the encoder', async () => {
    await encode();

    expect(frameClosed).toBe(true);
    expect(encoderClosed).toBe(true);
  });
});
