import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mux = vi.hoisted(() => ({
  buildCalls: [] as unknown[],
  stripCalls: [] as unknown[],
}));

vi.mock('../../../../src/tools/image/avif-mux', () => ({
  stripTemporalDelimiterObus: (data: Uint8Array): Uint8Array => {
    mux.stripCalls.push(data);

    return data;
  },
  buildAvifFile: (obu: Uint8Array, options: unknown): Uint8Array => {
    mux.buildCalls.push(options);

    return Uint8Array.from([1, 2, 3]);
  },
}));

import {
  encodeAvifWithVideoEncoder,
  pickSeqLevelIdx,
  qualityToQuantizer,
} from '../../../../src/tools/image/avif-webcodecs';

interface ChunkLike {
  type: string;
  byteLength: number;
  copyTo(dest: Uint8Array): void;
}

const chunk = (bytes: number[]): ChunkLike => ({
  type: 'key',
  byteLength: bytes.length,
  copyTo: (dest) => dest.set(bytes),
});

const state = {
  supported: true as boolean | undefined,
  configureCalls: [] as unknown[],
  encodeCalls: [] as unknown[],
  frameInits: [] as unknown[],
  supportRequests: [] as unknown[],
  contextIds: [] as string[],
  drawCalls: 0,
  emitChunk: true,
  emitError: false,
  supportThrows: false,
  encodeThrows: false,
  meta: undefined as unknown,
  metaOmitted: false,
  alpha: 255,
  contextAvailable: true,
};

const bitmap = { width: 8, height: 8, close: vi.fn() } as unknown as ImageBitmap;

const installGlobals = ({ encoder = 'function', frame = 'function', canvas = true } = {}): void => {
  const g = globalThis as Record<string, unknown>;

  class FakeEncoder {
    public constructor(private readonly init: {
      output: (c: ChunkLike, m?: unknown) => void;
      error: (e: unknown) => void;
    }) {}

    public static async isConfigSupported(config: Record<string, unknown>): Promise<{ supported?: boolean }> {
      state.supportRequests.push(config);

      if (state.supportThrows) {
        throw new Error('isConfigSupported exploded');
      }

      return { supported: state.supported };
    }

    public configure(config: Record<string, unknown>): void {
      state.configureCalls.push(config);
    }

    public encode(_frame: unknown, options?: Record<string, unknown>): void {
      state.encodeCalls.push(options);
      if (state.emitChunk) {
        this.init.output(chunk([9, 9, 9]), state.metaOmitted ? undefined : state.meta);
      }
      if (state.emitError) {
        this.init.error(new Error('encoder failed'));
      }
      if (state.encodeThrows) {
        throw new Error('encode exploded');
      }
    }

    public async flush(): Promise<void> {
      return undefined;
    }

    public close(): void {
      return undefined;
    }
  }

  class FakeFrame {
    public constructor(_source: unknown, init: { timestamp: number }) {
      state.frameInits.push(init);
    }

    public close(): void {
      return undefined;
    }
  }

  class FakeCanvas {
    public constructor(public width: number, public height: number) {}

    public getContext(id: string): unknown {
      state.contextIds.push(id);

      if (id !== '2d' || !state.contextAvailable) {
        return null;
      }

      return {
        drawImage: (): void => {
          state.drawCalls += 1;
        },
        getImageData: (): { data: Uint8ClampedArray } => ({
          // Alpha only reads as opaque once something has been drawn.
          data: Uint8ClampedArray.from([0, 0, 0, state.drawCalls > 0 ? state.alpha : 0]),
        }),
      };
    }
  }

  g.VideoEncoder = encoder === 'function' ? FakeEncoder : { isConfigSupported: FakeEncoder.isConfigSupported };
  g.VideoFrame = frame === 'function' ? FakeFrame : {};
  if (canvas) {
    g.OffscreenCanvas = FakeCanvas;
  } else {
    Reflect.deleteProperty(g, 'OffscreenCanvas');
  }
};

const encode = (): Promise<Blob | null> =>
  encodeAvifWithVideoEncoder(bitmap, { width: 8, height: 8 }, 0.5);

/**
 * Seven survivors are equivalent, in two groups.
 *
 * The three `?? ''` lookup keys: neither `''` nor the replacement string is a
 * key of the CICP tables, so both miss and both fall back to the same code.
 *
 * The four remaining are early returns whose fall-through lands in a catch that
 * produces the identical null: `if (!ctx)` and `if (!codecs)` and
 * `if (!encoded)` all dereference the very thing the guard was protecting, and
 * the enclosing try returns null for the throw. The captured-state object
 * literal is the same shape one level down — every field starts null or
 * undefined, and both read as falsy at the only place they are read.
 */
describe('avif-webcodecs mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mux.buildCalls.length = 0;
    mux.stripCalls.length = 0;
    state.supported = true;
    state.configureCalls.length = 0;
    state.encodeCalls.length = 0;
    state.frameInits.length = 0;
    state.supportRequests.length = 0;
    state.contextIds.length = 0;
    state.drawCalls = 0;
    state.emitChunk = true;
    state.emitError = false;
    state.supportThrows = false;
    state.encodeThrows = false;
    state.meta = { decoderConfig: { colorSpace: {} } };
    state.metaOmitted = false;
    state.alpha = 255;
    state.contextAvailable = true;
    installGlobals();
  });

  afterEach(() => {
    const g = globalThis as Record<string, unknown>;

    Reflect.deleteProperty(g, 'VideoEncoder');
    Reflect.deleteProperty(g, 'VideoFrame');
    Reflect.deleteProperty(g, 'OffscreenCanvas');
    vi.restoreAllMocks();
  });

  describe('picking an AV1 level', () => {
    it('accepts a frame sitting exactly on a level limit', () => {
      expect(pickSeqLevelIdx(2048, 72)).toBe(0);
      expect(pickSeqLevelIdx(128, 1152)).toBe(0);
    });

    it('climbs past a level whose width bound is too small', () => {
      expect(pickSeqLevelIdx(4000, 30)).toBe(4);
    });

    it('climbs past a level whose height bound is too small', () => {
      expect(pickSeqLevelIdx(40, 3000)).toBe(5);
    });

    it('refuses a frame no level can hold', () => {
      expect(pickSeqLevelIdx(20000, 20000)).toBeNull();
    });
  });

  describe('quality mapping', () => {
    it('maps the ends and the middle of the range', () => {
      expect([0, 0.5, 1].map(qualityToQuantizer)).toStrictEqual([63, 32, 0]);
    });
  });

  describe('the WebCodecs capability check', () => {
    it('never asks about a config when the encoder is not a constructor', async () => {
      installGlobals({ encoder: 'object' });

      expect(await encode()).toBeNull();
      expect(state.supportRequests).toStrictEqual([]);
    });

    it('never asks about a config when the frame type is not a constructor', async () => {
      installGlobals({ frame: 'object' });

      expect(await encode()).toBeNull();
      expect(state.supportRequests).toStrictEqual([]);
    });

    it('never asks about a config when there is no offscreen canvas', async () => {
      installGlobals({ canvas: false });

      expect(await encode()).toBeNull();
      expect(state.supportRequests).toStrictEqual([]);
    });
  });

  describe('the encode path', () => {
    it('asks about the exact config it will configure with', async () => {
      await encode();

      expect(state.supportRequests).toStrictEqual([{
        codec: 'av01.0.00M.08',
        width: 8,
        height: 8,
        bitrateMode: 'quantizer',
        latencyMode: 'quality',
      }]);
    });

    it('draws the bitmap into a 2d context and encodes one keyframe', async () => {
      const result = await encode();

      expect(result).toBeInstanceOf(Blob);
      expect(state.contextIds).toStrictEqual(['2d']);
      expect(state.drawCalls).toBe(1);
      expect(state.frameInits).toStrictEqual([{ timestamp: 0 }]);
      expect(state.encodeCalls).toStrictEqual([{ keyFrame: true, av1: { quantizer: 32 } }]);
    });

    it('gives up when the config is unsupported', async () => {
      state.supported = false;

      expect(await encode()).toBeNull();
      expect(mux.buildCalls).toStrictEqual([]);
    });

    it('gives up on a translucent image', async () => {
      state.alpha = 200;

      expect(await encode()).toBeNull();
      expect(mux.buildCalls).toStrictEqual([]);
    });

    it('gives up, without muxing, when no chunk arrives', async () => {
      state.emitChunk = false;

      expect(await encode()).toBeNull();
      expect(mux.buildCalls).toStrictEqual([]);
    });

    // A chunk AND an error is the only shape that separates the failure check
    // from the missing-chunk check: either one alone leaves both readings null.
    it('gives up when the encoder reported an error even though a chunk arrived', async () => {
      state.emitError = true;

      expect(await encode()).toBeNull();
      expect(mux.buildCalls).toStrictEqual([]);
    });

    it('returns null, not undefined, when the capability check itself throws', async () => {
      state.supportThrows = true;

      expect(await encode()).toBeNull();
    });

    // The chunk arrives before the throw, so the state left behind looks like a
    // success. Only the catch's own return keeps it from being muxed.
    it('discards a chunk captured before the encoder threw', async () => {
      state.encodeThrows = true;

      expect(await encode()).toBeNull();
      expect(mux.buildCalls).toStrictEqual([]);
    });
  });

  describe('colour signalling', () => {
    it('translates the reported colour space', async () => {
      state.meta = {
        decoderConfig: {
          colorSpace: { primaries: 'bt470bg', transfer: 'iec61966-2-1', matrix: 'rgb', fullRange: true },
        },
      };
      await encode();

      expect(mux.buildCalls).toStrictEqual([{
        width: 8,
        height: 8,
        seqProfile: 0,
        seqLevelIdx: 0,
        tier: 0,
        colorPrimaries: 5,
        transferCharacteristics: 13,
        matrixCoefficients: 0,
        fullRange: true,
      }]);
    });

    it('falls back to BT.709 limited range for names it does not know', async () => {
      state.meta = { decoderConfig: { colorSpace: { primaries: 'unknown', transfer: null } } };
      await encode();

      expect(mux.buildCalls).toStrictEqual([{
        width: 8,
        height: 8,
        seqProfile: 0,
        seqLevelIdx: 0,
        tier: 0,
        colorPrimaries: 1,
        transferCharacteristics: 1,
        matrixCoefficients: 1,
        fullRange: false,
      }]);
    });

    it('survives metadata with no decoder config, and none at all', async () => {
      state.meta = {};

      expect(await encode()).toBeInstanceOf(Blob);

      state.metaOmitted = true;
      mux.buildCalls.length = 0;

      expect(await encode()).toBeInstanceOf(Blob);
    });
  });
});
