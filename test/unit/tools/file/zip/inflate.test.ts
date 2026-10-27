// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { inflateRaw } from '../../../../../src/tools/file/zip/inflate';
import { ZipError } from '../../../../../src/tools/file/zip/zip-error';

const FIXTURES = path.join(__dirname, 'fixtures', 'pako');

/** Deterministic PRNG (mulberry32) so failures reproduce. */
const prng = (seed: number): (() => number) => {
  let a = seed >>> 0;

  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const randomBytes = (n: number, seed: number): Uint8Array => {
  const rnd = prng(seed);
  const out = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    out[i] = Math.floor(rnd() * 256);
  }

  return out;
};

const repetitiveText = (n: number): Uint8Array => {
  const unit = Buffer.from('<w:r><w:t xml:space="preserve">Lorem ipsum dolor sit amet, </w:t></w:r>\n');
  const out = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    out[i] = unit[i % unit.length];
  }

  return out;
};

type Kind = 'zeros' | 'random' | 'text';

const makeData = (kind: Kind, n: number): Uint8Array => {
  if (kind === 'zeros') {
    return new Uint8Array(n);
  }

  return kind === 'random' ? randomBytes(n, n + 1) : repetitiveText(n);
};

const u8 = (b: Buffer): Uint8Array => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);

/** vitest's toEqual walks typed arrays element by element, too slow for these loops. */
const expectBytes = (actual: Uint8Array | Error, expected: Uint8Array): void => {
  expect(actual).toBeInstanceOf(Uint8Array);
  if (actual instanceof Uint8Array) {
    expect(actual.length).toBe(expected.length);
    expect(Buffer.compare(actual, expected)).toBe(0);
  }
};

const hex = (s: string): Uint8Array => Uint8Array.from(s.split(' ').map((h) => parseInt(h, 16)));

/** Writes a DEFLATE bit stream: fields LSB first, Huffman codes MSB first. */
class BitWriter {
  private readonly out: number[] = [];
  private acc = 0;
  private n = 0;

  public bits(value: number, count: number): this {
    for (let i = 0; i < count; i++) {
      this.acc |= ((value >>> i) & 1) << this.n;
      this.n++;
      if (this.n === 8) {
        this.out.push(this.acc);
        this.acc = 0;
        this.n = 0;
      }
    }

    return this;
  }

  public code(code: number, len: number): this {
    for (let i = len - 1; i >= 0; i--) {
      this.bits((code >>> i) & 1, 1);
    }

    return this;
  }

  public align(): this {
    return this.n > 0 ? this.bits(0, 8 - this.n) : this;
  }

  public bytes(data: Uint8Array): this {
    this.align();
    data.forEach((b) => this.out.push(b));

    return this;
  }

  public finish(): Uint8Array {
    this.align();

    return Uint8Array.from(this.out);
  }
}

/** Canonical Huffman codes (RFC 1951 3.2.2) for the given code lengths. */
const canonical = (lengths: number[]): number[] => {
  const count = new Array<number>(16).fill(0);

  lengths.forEach((l) => {
    count[l]++;
  });
  count[0] = 0;
  const next = new Array<number>(16).fill(0);
  let code = 0;

  for (let bits = 1; bits < 16; bits++) {
    code = (code + count[bits - 1]) << 1;
    next[bits] = code;
  }

  return lengths.map((l) => (l === 0 ? -1 : next[l]++));
};

interface Coder {
  lit: (sym: number) => void;
  dist: (sym: number) => void;
}

const coder = (w: BitWriter, litLens: number[], distLens: number[]): Coder => {
  const litCodes = canonical(litLens);
  const distCodes = canonical(distLens);

  return {
    lit: (sym) => {
      w.code(litCodes[sym], litLens[sym]);
    },
    dist: (sym) => {
      w.code(distCodes[sym], distLens[sym]);
    },
  };
};

const FIXED_LIT = Array.from({ length: 288 }, (_, i) => {
  if (i < 144) {
    return 8;
  }
  if (i < 256) {
    return 9;
  }

  return i < 280 ? 7 : 8;
});
const FIXED_DIST = new Array<number>(32).fill(5);

const fixedBlock = (w: BitWriter, final: boolean): Coder => {
  w.bits(final ? 1 : 0, 1).bits(1, 2);

  return coder(w, FIXED_LIT, FIXED_DIST);
};

/**
 * Dynamic block header whose code length code gives symbols 0..15 four bits
 * each, so every length is written as one plain symbol.
 */
const dynamicBlock = (w: BitWriter, litLens: number[], distLens: number[]): Coder => {
  const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  w.bits(1, 1).bits(2, 2).bits(litLens.length - 257, 5).bits(distLens.length - 1, 5).bits(15, 4);
  order.forEach((sym) => w.bits(sym < 16 ? 4 : 0, 3));
  [...litLens, ...distLens].forEach((l) => w.code(l, 4));

  return coder(w, litLens, distLens);
};

/** Lengths array of `n` zeros with the given symbols set. */
const lens = (n: number, set: Record<number, number>): number[] => {
  const out = new Array<number>(n).fill(0);

  Object.entries(set).forEach(([sym, len]) => {
    out[Number(sym)] = len;
  });

  return out;
};

const zlibOutcome = (src: Uint8Array): Uint8Array | Error => {
  try {
    return u8(zlib.inflateRawSync(src));
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
};

const ourOutcome = (src: Uint8Array, size: number): Uint8Array | ZipError => {
  try {
    return inflateRaw(src, size);
  } catch (e) {
    if (e instanceof ZipError) {
      return e;
    }
    throw e;
  }
};

/**
 * Where zlib fails we must fail. Where zlib succeeds, the declared size is its
 * output length, so we must return the same bytes; one byte more must fail.
 */
const expectAgreesWithZlib = (src: Uint8Array): void => {
  const ref = zlibOutcome(src);

  if (ref instanceof Error) {
    expect(ourOutcome(src, 1 << 16)).toBeInstanceOf(ZipError);

    return;
  }
  expectBytes(ourOutcome(src, ref.length), ref);
  expect(ourOutcome(src, ref.length + 1)).toBeInstanceOf(ZipError);
};

const roundTrip = (data: Uint8Array, options: zlib.ZlibOptions = {}): void => {
  const deflated = u8(zlib.deflateRawSync(data, options));
  const inflated = inflateRaw(deflated, data.length);

  expect(inflated.length).toBe(data.length);
  expect(Buffer.compare(inflated, data)).toBe(0);
};

const loadDir = (dir: string): Array<[string, Uint8Array]> =>
  readdirSync(path.join(FIXTURES, dir)).sort().map((name) => [name, u8(readFileSync(path.join(FIXTURES, dir, name)))]);

const samples = loadDir('samples');

describe('inflateRaw - pako fixtures', () => {
  it.each(loadDir('samples_deflated_raw'))('inflates %s like zlib does', (_name, compressed) => {
    const ref = u8(zlib.inflateRawSync(compressed));

    expect(Buffer.compare(inflateRaw(compressed, ref.length), ref)).toBe(0);
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])('round-trips the samples at level %i', (level) => {
    samples.forEach(([, data]) => roundTrip(data, { level }));
  });

  it.each([9, 10, 11, 12, 13, 14, 15])('round-trips the samples at windowBits %i', (windowBits) => {
    samples.forEach(([, data]) => roundTrip(data, { windowBits }));
  });

  it.each([
    zlib.constants.Z_DEFAULT_STRATEGY,
    zlib.constants.Z_FILTERED,
    zlib.constants.Z_HUFFMAN_ONLY,
    zlib.constants.Z_RLE,
    zlib.constants.Z_FIXED,
  ])('round-trips the samples with strategy %i', (strategy) => {
    samples.forEach(([, data]) => roundTrip(data, { strategy }));
  });

  it('throws on a truncated raw stream', () => {
    const data = Buffer.from('payload that will be cut');
    const full = u8(zlib.deflateRawSync(data));

    expect(() => inflateRaw(full.subarray(0, full.length - 4), data.length)).toThrow(ZipError);
  });

  // zlib's own inflate cover vectors (zlib test/infcover.c via pako), all Z_DATA_ERROR there.
  const errorVectors = [
    '0 0 0 0 0',
    '6',
    'fc 0 0',
    '4 0 fe ff',
    '4 0 24 49 0',
    '4 0 24 e9 ff ff',
    '4 0 24 e9 ff 6d',
    '4 80 49 92 24 49 92 24 71 ff ff 93 11 0',
    '4 80 49 92 24 49 92 24 f b4 ff ff c3 84',
    '2 7e ff ff',
    'c c0 81 0 0 0 0 0 90 ff 6b 4 0',
  ];

  it.each(errorVectors)('rejects cover vector [%s] for the same reason as zlib', (bytes) => {
    const src = hex(bytes);
    const ref = zlibOutcome(src);

    expect(ref).toBeInstanceOf(Error);
    expect(() => inflateRaw(src, 1 << 16)).toThrow(new ZipError(ref instanceof Error ? ref.message : ''));
  });

  const otherVectors = [
    '3 0',
    '1 1 0 fe ff 0',
    '5 c0 21 d 0 0 0 80 b0 fe 6d 2f 91 6c',
    '5 e0 81 91 24 cb b2 2c 49 e2 f 2e 8b 9a 47 56 9f fb fe ec d2 ff 1f',
    'ed c0 1 1 0 0 0 40 20 ff 57 1b 42 2c 4f',
    'ed cf c1 b1 2c 47 10 c4 30 fa 6f 35 1d 1 82 59 3d fb be 2e 2a fc f c',
    'ed c0 81 0 0 0 0 80 a0 fd a9 17 a9 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 6',
    '2 8 20 80 0 3 0',
    '63 18 5 40 c 0',
    'e5 e0 81 ad 6d cb b2 2c c9 01 1e 59 63 ae 7d ee fb 4d fd b5 35 41 68 ff 7f 0f 0 0 0',
    '25 fd 81 b5 6d 59 b6 6a 49 ea af 35 6 34 eb 8c b9 f6 b9 1e ef 67 49 50 fe ff ff 3f 0 0',
    '1b 7 0 0 0 0 0',
    'd c7 1 ae eb 38 c 4 41 a0 87 72 de df fb 1f b8 36 b1 38 5d ff ff 0',
    '63 18 5 8c 10 8 0 0 0 0',
    '63 60 60 18 c9 0 8 18 18 18 26 c0 28 0 29 0 0 0',
    '63 0 3 0 0 0 0 0',
    '63 0',
    '63 18 5',
    '63 18 68 30 d0 0 0',
    '',
  ];

  it.each(otherVectors)('agrees with zlib on cover vector [%s]', (bytes) => {
    expectAgreesWithZlib(bytes === '' ? new Uint8Array(0) : hex(bytes));
  });
});

describe('inflateRaw - differential against zlib.deflateRawSync', () => {
  const kinds: Kind[] = ['zeros', 'random', 'text'];
  const strategies = [
    zlib.constants.Z_DEFAULT_STRATEGY,
    zlib.constants.Z_FILTERED,
    zlib.constants.Z_HUFFMAN_ONLY,
    zlib.constants.Z_RLE,
    zlib.constants.Z_FIXED,
  ];

  it('round-trips every level x strategy x data kind', () => {
    kinds.forEach((kind) => {
      const data = makeData(kind, 70_000);

      for (let level = 0; level <= 9; level++) {
        strategies.forEach((strategy) => roundTrip(data, { level, strategy }));
      }
    });
  });

  it('round-trips every windowBits x memLevel', () => {
    kinds.forEach((kind) => {
      const data = makeData(kind, 100_000);

      for (let windowBits = 9; windowBits <= 15; windowBits++) {
        [1, 9].forEach((memLevel) => roundTrip(data, { windowBits, memLevel }));
      }
    });
  });

  it('round-trips boundary sizes', () => {
    const sizes = [0, 1, 2, 3, 258, 259, 32767, 32768, 32769, 65535, 65536];

    kinds.forEach((kind) => {
      sizes.forEach((n) => {
        const data = makeData(kind, n);

        [0, 1, 6, 9].forEach((level) => roundTrip(data, { level }));
      });
    });
  });

  it('round-trips about 1 MB of each kind', () => {
    kinds.forEach((kind) => roundTrip(makeData(kind, 1_048_583)));
  });

  it('round-trips long runs that repeat 32 KB back', () => {
    const block = randomBytes(32768, 7);
    const data = new Uint8Array(32768 * 6);

    for (let i = 0; i < 6; i++) {
      data.set(block, i * 32768);
    }
    [1, 6, 9].forEach((level) => roundTrip(data, { level }));
  });

  it('copies from exactly 32768 bytes back', () => {
    const head = randomBytes(32768, 11);
    const w = new BitWriter();

    w.bits(0, 1).bits(0, 2).align().bits(32768, 16).bits(~32768 & 0xffff, 16).bytes(head);
    const c = fixedBlock(w, true);

    c.lit(285);
    c.dist(29);
    w.bits(8191, 13);
    c.lit(256);
    const src = w.finish();
    const expected = new Uint8Array(32768 + 258);

    expected.set(head);
    expected.set(head.subarray(0, 258), 32768);

    expectBytes(u8(zlib.inflateRawSync(src)), expected);
    expectBytes(inflateRaw(src, expected.length), expected);
  });

  it('decodes a stream whose end-of-block code ends in the last bit', () => {
    // 3 header bits + six 9-bit literals + 7-bit EOB = 64 bits, no padding.
    const w = new BitWriter();
    const c = fixedBlock(w, true);

    [0xc8, 0xc9, 0xca, 0xcb, 0xcc, 0xcd].forEach((sym) => c.lit(sym));
    c.lit(256);
    const src = w.finish();

    expect(src.length).toBe(8);
    expect(inflateRaw(src, 6)).toEqual(Uint8Array.of(0xc8, 0xc9, 0xca, 0xcb, 0xcc, 0xcd));
    for (let i = 0; i < src.length; i++) {
      expectAgreesWithZlib(src.subarray(0, i));
    }
  });

  it('keeps reading blocks after the output is full', () => {
    const data = repetitiveText(5000);
    const flushed = u8(zlib.deflateRawSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH }));
    const src = new Uint8Array(flushed.length + 2);

    src.set(flushed);
    src.set([0x03, 0x00], flushed.length);

    expect(Buffer.compare(inflateRaw(src, data.length), data)).toBe(0);
    // Without the final block the stream is unfinished, even though the output is full.
    expect(() => inflateRaw(flushed, data.length)).toThrow(ZipError);
  });

  it('ignores bytes after the final block', () => {
    const data = repetitiveText(1000);
    const deflated = u8(zlib.deflateRawSync(data));
    const src = new Uint8Array(deflated.length + 4);

    src.set(deflated);
    src.set([1, 2, 3, 4], deflated.length);

    expect(Buffer.compare(inflateRaw(src, data.length), data)).toBe(0);
  });

  it('accepts a literal/length code with a single one-bit code, as zlib does', () => {
    const w = new BitWriter();
    const c = dynamicBlock(w, lens(257, { 256: 1 }), [0]);

    c.lit(256);
    const src = w.finish();

    expect(u8(zlib.inflateRawSync(src))).toEqual(new Uint8Array(0));
    expect(inflateRaw(src, 0)).toEqual(new Uint8Array(0));
  });

  it('accepts a distance code with a single one-bit code, as zlib does', () => {
    const w = new BitWriter();
    const c = dynamicBlock(w, lens(258, { 0x61: 1, 256: 2, 257: 2 }), [1]);

    c.lit(0x61);
    c.lit(257);
    c.dist(0);
    c.lit(256);
    const src = w.finish();
    const expected = Uint8Array.from([0x61, 0x61, 0x61, 0x61]);

    expect(u8(zlib.inflateRawSync(src))).toEqual(expected);
    expect(inflateRaw(src, 4)).toEqual(expected);
  });
});

describe('inflateRaw - malformed input', () => {
  /** Ours must throw this message, and zlib must reject the same stream. */
  const expectRejected = (src: Uint8Array, message: string, zlibMessage = message): void => {
    expect(() => zlib.inflateRawSync(src)).toThrow(zlibMessage);
    expect(() => inflateRaw(src, 1 << 16)).toThrow(new ZipError(message));
  };

  it('rejects block type 3', () => {
    expectRejected(new BitWriter().bits(1, 1).bits(3, 2).finish(), 'invalid block type');
  });

  it('rejects a stored block whose LEN and NLEN do not match', () => {
    const src = new BitWriter().bits(1, 1).bits(0, 2).align().bits(1, 16).bits(0, 16).bytes(Uint8Array.of(0x61)).finish();

    expectRejected(src, 'invalid stored block lengths');
  });

  it('rejects a stored block longer than the input', () => {
    const src = new BitWriter().bits(1, 1).bits(0, 2).align().bits(10, 16).bits(~10 & 0xffff, 16).bytes(Uint8Array.of(1, 2, 3)).finish();

    expect(() => zlib.inflateRawSync(src)).toThrow();
    expect(() => inflateRaw(src, 10)).toThrow(new ZipError('unexpected end of data'));
  });

  it.each([286, 287])('rejects fixed literal/length code %i', (sym) => {
    const w = new BitWriter();
    const c = fixedBlock(w, true);

    c.lit(0x61);
    c.lit(sym);
    c.lit(256);
    expectRejected(w.finish(), 'invalid literal/length code');
  });

  it.each([30, 31])('rejects fixed distance code %i', (sym) => {
    const w = new BitWriter();
    const c = fixedBlock(w, true);

    c.lit(0x61);
    c.lit(257);
    c.dist(sym);
    c.lit(256);
    expectRejected(w.finish(), 'invalid distance code');
  });

  it('rejects a distance farther back than the bytes written', () => {
    const w = new BitWriter();
    const c = fixedBlock(w, true);

    c.lit(0x61);
    c.lit(257);
    c.dist(1);
    c.lit(256);
    expectRejected(w.finish(), 'invalid distance too far back');
  });

  it('rejects literal/length codes 286-287 and distance codes 30-31 in a dynamic header', () => {
    // HLIT 30 means 287 codes, HDIST 30 means 31 codes.
    expectRejected(new BitWriter().bits(1, 1).bits(2, 2).bits(30, 5).bits(0, 5).bits(0, 4).bits(0, 30).finish(),
      'too many length or distance symbols');
    expectRejected(new BitWriter().bits(1, 1).bits(2, 2).bits(0, 5).bits(30, 5).bits(0, 4).bits(0, 30).finish(),
      'too many length or distance symbols');
  });

  /** Dynamic header with the given code length code (by symbol), HLIT=257, HDIST=1. */
  const clHeader = (clLens: Record<number, number>): BitWriter => {
    const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
    const w = new BitWriter().bits(1, 1).bits(2, 2).bits(0, 5).bits(0, 5).bits(15, 4);

    order.forEach((sym) => w.bits(clLens[sym] ?? 0, 3));

    return w;
  };

  it('rejects repeat code 16 with no previous length', () => {
    // Code length code: 0 -> '0', 16 -> '1'.
    expectRejected(clHeader({ 0: 1, 16: 1 }).code(1, 1).bits(0, 2).bits(0, 32).finish(), 'invalid bit length repeat');
  });

  it('rejects code lengths that overflow HLIT + HDIST', () => {
    // 0 -> '0', 18 -> '1'; two runs of 138 zeros exceed 258.
    expectRejected(clHeader({ 0: 1, 18: 1 }).code(1, 1).bits(127, 7).code(1, 1).bits(127, 7).bits(0, 32).finish(),
      'invalid bit length repeat');
  });

  it('rejects an over-subscribed code length code', () => {
    expectRejected(clHeader({ 16: 1, 17: 1, 18: 1 }).bits(0, 32).finish(), 'invalid code lengths set');
  });

  it('rejects an incomplete code length code, even with a single code', () => {
    expectRejected(clHeader({ 18: 1 }).bits(0, 32).finish(), 'invalid code lengths set');
    expectRejected(clHeader({ 0: 2, 18: 2 }).bits(0, 32).finish(), 'invalid code lengths set');
  });

  it('rejects an over-subscribed literal/length code', () => {
    const w = new BitWriter();

    dynamicBlock(w, lens(257, { 0: 1, 1: 1, 256: 1 }), [1]);
    expectRejected(w.bits(0, 16).finish(), 'invalid literal/lengths set');
  });

  it('rejects an incomplete literal/length code', () => {
    const w = new BitWriter();

    dynamicBlock(w, lens(257, { 0: 2, 256: 2 }), [1]);
    expectRejected(w.bits(0, 16).finish(), 'invalid literal/lengths set');
  });

  it('rejects an over-subscribed or incomplete distance code', () => {
    const over = new BitWriter();

    dynamicBlock(over, lens(257, { 0: 1, 256: 1 }), [1, 1, 1]);
    expectRejected(over.bits(0, 16).finish(), 'invalid distances set');

    const incomplete = new BitWriter();

    dynamicBlock(incomplete, lens(257, { 0: 1, 256: 1 }), [2, 2]);
    expectRejected(incomplete.bits(0, 16).finish(), 'invalid distances set');
  });

  it('rejects a literal/length code without an end-of-block code', () => {
    const w = new BitWriter();

    dynamicBlock(w, lens(257, { 0: 1, 1: 1 }), [1]);
    expectRejected(w.bits(0, 16).finish(), 'invalid code -- missing end-of-block');
  });

  it('stops at the end of the input even when the missing bits would decode as literals', () => {
    // '0' is 'a', so zeros past the end would keep writing 'a' until the output is full.
    const w = new BitWriter();
    const c = dynamicBlock(w, lens(257, { 0x61: 1, 256: 1 }), [0]);

    c.lit(0x61);
    expect(() => inflateRaw(w.finish(), 1 << 20)).toThrow(new ZipError('unexpected end of data'));
  });

  it('throws on the first literal past the declared size', () => {
    const w = new BitWriter();
    const c = fixedBlock(w, true);

    [0x61, 0x62, 0x63].forEach((sym) => c.lit(sym));
    c.lit(256);
    const src = w.finish();

    expect(inflateRaw(src, 3)).toEqual(Uint8Array.of(0x61, 0x62, 0x63));
    expect(() => inflateRaw(src, 2)).toThrow(new ZipError('output larger than declared size'));
  });

  it('rejects input that ends before the final block', () => {
    expect(() => inflateRaw(new Uint8Array(0), 0)).toThrow(new ZipError('unexpected end of data'));
    expect(() => inflateRaw(Uint8Array.of(0x00), 0)).toThrow(ZipError);
  });

  it('throws when the output is shorter than the declared size', () => {
    const data = repetitiveText(1000);
    const src = u8(zlib.deflateRawSync(data));

    expect(() => inflateRaw(src, 1001)).toThrow(new ZipError('output smaller than declared size'));
    expect(() => inflateRaw(u8(zlib.deflateRawSync(new Uint8Array(0))), 1)).toThrow(ZipError);
  });

  it('stops as soon as the output would pass the declared size', () => {
    // 16 MB of zeros, cut to half: hitting the cut would throw a different error.
    const full = u8(zlib.deflateRawSync(new Uint8Array(16 << 20), { level: 1 }));
    const cut = full.subarray(0, full.length >> 1);

    expect(() => inflateRaw(cut, 1024)).toThrow(new ZipError('output larger than declared size'));
    expect(() => inflateRaw(full, (16 << 20) - 1)).toThrow(new ZipError('output larger than declared size'));
  });

  it('stops a 1 GB zip bomb with a 1 KB output buffer', () => {
    // 1 MB of zeros flushed to a byte boundary; 1024 copies plus a final empty block is 1 GB.
    const chunk = u8(zlib.deflateRawSync(new Uint8Array(1 << 20), { finishFlush: zlib.constants.Z_SYNC_FLUSH }));
    const build = (copies: number): Uint8Array => {
      const out = new Uint8Array(chunk.length * copies + 2);

      for (let i = 0; i < copies; i++) {
        out.set(chunk, i * chunk.length);
      }
      out.set([0x03, 0x00], chunk.length * copies);

      return out;
    };

    expectBytes(u8(zlib.inflateRawSync(build(4))), new Uint8Array(4 << 20));

    expect(() => inflateRaw(build(1024), 1024)).toThrow(new ZipError('output larger than declared size'));
  });

  const validStreams: Array<[string, Uint8Array, number]> = (() => {
    const text = repetitiveText(3000);
    const mixed = new Uint8Array(1500);

    mixed.set(repetitiveText(1000));
    mixed.set(randomBytes(500, 3), 1000);

    return [
      ['fixed', u8(zlib.deflateRawSync(Buffer.from('hello hello hello world'), { strategy: zlib.constants.Z_FIXED })), 23],
      ['dynamic', u8(zlib.deflateRawSync(text)), text.length],
      ['stored', u8(zlib.deflateRawSync(text.subarray(0, 300), { level: 0 })), 300],
      ['mixed', u8(zlib.deflateRawSync(mixed, { level: 9 })), mixed.length],
    ];
  })();

  it.each(validStreams)('rejects every truncation of the %s stream', (_name, src, size) => {
    for (let n = 0; n < src.length; n++) {
      const prefix = src.subarray(0, n);

      expect(zlibOutcome(prefix)).toBeInstanceOf(Error);
      expect(ourOutcome(prefix, size)).toBeInstanceOf(ZipError);
    }
  });

  it.each(validStreams)('handles every flipped bit of the %s stream like zlib', (_name, src, size) => {
    for (let bit = 0; bit < src.length * 8; bit++) {
      const bad = src.slice();

      bad[bit >> 3] ^= 1 << (bit & 7);
      const ref = zlibOutcome(bad);
      const ours = ourOutcome(bad, size);

      if (ref instanceof Error || ref.length !== size) {
        expect(ours).toBeInstanceOf(ZipError);
      } else {
        expectBytes(ours, ref);
      }
    }
  });

  it('handles random byte strings like zlib', () => {
    const rnd = prng(42);

    for (let i = 0; i < 3000; i++) {
      const src = randomBytes(Math.floor(rnd() * 80), i);

      // Mostly start with a dynamic or fixed final block header to get past the first byte.
      if (src.length > 0 && i % 3 !== 0) {
        src[0] = (src[0] & ~7) | (i % 3 === 1 ? 0b101 : 0b011);
      }
      expectAgreesWithZlib(src);
    }
  });
});
