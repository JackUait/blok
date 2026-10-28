/* eslint-disable no-restricted-syntax -- the bit cursor lives in mutable locals; this is the hot path of every zip read */
import { ZipError } from './zip-error';

const LEN_BASE = Uint16Array.of(3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258);
const LEN_EXTRA = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0);
const DIST_BASE = Uint16Array.of(1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577);
const DIST_EXTRA = Uint8Array.of(0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13);
const CL_ORDER = Uint8Array.of(16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15);

// Format errors reuse zlib's wording, so tests can check both decoders reject a stream for the same reason.
const END = 'unexpected end of data';
const LARGER = 'output larger than declared size';
const SMALLER = 'output smaller than declared size';
const BAD_LIT = 'invalid literal/length code';
const BAD_DIST = 'invalid distance code';

/**
 * Codes up to this long decode with one lookup. Longer codes take the slow path, so
 * building a table costs at most 2^ROOT_BITS entries, however deep the code goes.
 */
const ROOT_BITS = 9;

interface Huffman {
  /** `fast[next input bits]` is `symbol << 4 | codeLength`; 0 for longer codes and for no code. */
  fast: Uint16Array;
  /** Canonical form, as in zlib's puff: codes per length and symbols in code order. */
  count: Uint16Array;
  symbol: Uint16Array;
}

/** Builds a Huffman decoder from code lengths. Rejects the code sets zlib rejects. */
function buildTable(lengths: Uint8Array, start: number, n: number, error: string, allowSingle: boolean): Huffman {
  const count = new Uint16Array(16);
  let maxLen = 0;

  for (let i = 0; i < n; i++) {
    count[lengths[start + i]]++;
    maxLen = Math.max(maxLen, lengths[start + i]);
  }
  count[0] = 0;
  let left = 1;

  for (let len = 1; len < 16; len++) {
    left = (left << 1) - count[len];
    if (left < 0) {
      throw new ZipError(error);
    }
  }
  // zlib allows one incomplete set: lit/len or distance codes with a single one-bit code (or none).
  if (left > 0 && !(allowSingle && maxLen <= 1)) {
    throw new ZipError(error);
  }
  const size = 1 << Math.min(maxLen, ROOT_BITS);
  const fast = new Uint16Array(size);
  const symbol = new Uint16Array(n);
  const next = new Uint16Array(16);
  const offset = new Uint16Array(16);
  let code = 0;

  for (let len = 1; len < 16; len++) {
    code = (code + count[len - 1]) << 1;
    next[len] = code;
    offset[len] = len === 1 ? 0 : offset[len - 1] + count[len - 1];
  }
  for (let sym = 0; sym < n; sym++) {
    const len = lengths[start + sym];

    if (len === 0) {
      continue;
    }
    symbol[offset[len]++] = sym;
    if (len > ROOT_BITS) {
      continue;
    }
    // Codes are packed MSB first but read LSB first, so the table index is the reversed code.
    let rev = 0;

    for (let c = next[len]++, i = 0; i < len; i++, c >>>= 1) {
      rev = (rev << 1) | (c & 1);
    }
    for (let i = rev; i < size; i += 1 << len) {
      fast[i] = (sym << 4) | len;
    }
  }

  return { fast, count, symbol };
}

/** Decodes a code longer than ROOT_BITS bit by bit. `buf` must hold 15 bits. Returns 0 for no code. */
function slowDecode(h: Huffman, buf: number): number {
  let code = 0;
  let first = 0;
  let index = 0;

  for (let len = 1; len < 16; len++) {
    code |= (buf >>> (len - 1)) & 1;
    if (code - first < h.count[len]) {
      return (h.symbol[index + code - first] << 4) | len;
    }
    index += h.count[len];
    first = (first + h.count[len]) << 1;
    code <<= 1;
  }

  return 0;
}

const fixedLengths = new Uint8Array(288 + 32);

fixedLengths.fill(8, 0, 144).fill(9, 144, 256).fill(7, 256, 280).fill(8, 280, 288).fill(5, 288);
const FIXED_LIT = buildTable(fixedLengths, 0, 288, BAD_LIT, false);
const FIXED_DIST = buildTable(fixedLengths, 288, 32, BAD_DIST, false);

const lengths = new Uint8Array(286 + 30);

class Inflater {
  private readonly out: Uint8Array;
  private outPos = 0;
  /** Next input byte to load into `buf`. Runs past the end by a few bytes, which read as zeros. */
  private pos = 0;
  private buf = 0;
  private cnt = 0;

  constructor(private readonly src: Uint8Array, size: number) {
    this.out = new Uint8Array(size);
  }

  public run(): Uint8Array {
    let final = 0;

    while (final === 0) {
      final = this.bits(1);
      const type = this.bits(2);

      if (type === 0) {
        this.stored();
      } else if (type === 1) {
        this.codes(FIXED_LIT, FIXED_DIST);
      } else if (type === 2) {
        this.dynamic();
      } else {
        throw new ZipError('invalid block type');
      }
    }
    this.fill(0);
    if (this.outPos !== this.out.length) {
      throw new ZipError(SMALLER);
    }

    return this.out;
  }

  /**
   * Loads bytes until `buf` holds at least `n` bits. Zeros stand in for bytes past the end;
   * the check here throws once more bits were consumed than the input has.
   */
  private fill(n: number): void {
    if (this.pos * 8 - this.cnt > this.src.length * 8) {
      throw new ZipError(END);
    }
    while (this.cnt < n) {
      this.buf |= (this.pos < this.src.length ? this.src[this.pos] : 0) << this.cnt;
      this.pos++;
      this.cnt += 8;
    }
  }

  private bits(n: number): number {
    this.fill(n);
    const value = this.buf & ((1 << n) - 1);

    this.buf >>>= n;
    this.cnt -= n;

    return value;
  }

  private stored(): void {
    this.buf >>>= this.cnt & 7;
    this.cnt -= this.cnt & 7;
    const len = this.bits(16);
    const nlen = this.bits(16);

    this.fill(0);
    if (len !== (~nlen & 0xffff)) {
      throw new ZipError('invalid stored block lengths');
    }
    const start = this.pos - (this.cnt >> 3);

    if (start + len > this.src.length) {
      throw new ZipError(END);
    }
    if (this.outPos + len > this.out.length) {
      throw new ZipError(LARGER);
    }
    this.out.set(this.src.subarray(start, start + len), this.outPos);
    this.outPos += len;
    this.pos = start + len;
    this.buf = 0;
    this.cnt = 0;
  }

  private dynamic(): void {
    const nlen = this.bits(5) + 257;
    const ndist = this.bits(5) + 1;
    const ncode = this.bits(4) + 4;

    if (nlen > 286 || ndist > 30) {
      throw new ZipError('too many length or distance symbols');
    }
    lengths.fill(0, 0, 19);
    for (let i = 0; i < ncode; i++) {
      lengths[CL_ORDER[i]] = this.bits(3);
    }
    const clTable = buildTable(lengths, 0, 19, 'invalid code lengths set', false);
    const clBits = Math.log2(clTable.fast.length);
    const total = nlen + ndist;

    for (let i = 0; i < total;) {
      // The code length code is complete, so every lookup hits a code.
      this.fill(clBits);
      const entry = clTable.fast[this.buf & ((1 << clBits) - 1)];

      this.buf >>>= entry & 15;
      this.cnt -= entry & 15;
      const sym = entry >>> 4;

      if (sym < 16) {
        lengths[i++] = sym;
        continue;
      }
      if (sym === 16 && i === 0) {
        throw new ZipError('invalid bit length repeat');
      }
      const value = sym === 16 ? lengths[i - 1] : 0;
      const repeat = this.repeatCount(sym);

      if (i + repeat > total) {
        throw new ZipError('invalid bit length repeat');
      }
      lengths.fill(value, i, i + repeat);
      i += repeat;
    }
    if (lengths[256] === 0) {
      throw new ZipError('invalid code -- missing end-of-block');
    }
    const lit = buildTable(lengths, 0, nlen, 'invalid literal/lengths set', true);
    const dist = buildTable(lengths, nlen, ndist, 'invalid distances set', true);

    this.codes(lit, dist);
  }

  /** How many times code length symbol 16, 17 or 18 repeats. */
  private repeatCount(sym: number): number {
    if (sym === 16) {
      return 3 + this.bits(2);
    }

    return sym === 17 ? 3 + this.bits(3) : 11 + this.bits(7);
  }

  /** Decodes one Huffman-coded block. Keeps state in locals: this loop is where the time goes. */
  private codes(lit: Huffman, dist: Huffman): void {
    const { src, out } = this;
    const srcBits = src.length * 8;
    const litFast = lit.fast;
    const distFast = dist.fast;
    const litMask = litFast.length - 1;
    const distMask = distFast.length - 1;
    let { pos, buf, cnt, outPos } = this;

    for (;;) {
      // Refilling never changes pos * 8 - cnt, the bits consumed, so one check per symbol is enough.
      if (pos * 8 - cnt > srcBits) {
        throw new ZipError(END);
      }
      while (cnt < 25) {
        buf |= (pos < src.length ? src[pos] : 0) << cnt;
        pos++;
        cnt += 8;
      }
      let entry = litFast[buf & litMask];

      if (entry === 0) {
        entry = slowDecode(lit, buf);
      }
      let len = entry & 15;

      if (len === 0) {
        throw new ZipError(BAD_LIT);
      }
      buf >>>= len;
      cnt -= len;
      const sym = entry >>> 4;

      if (sym < 256 && outPos < out.length) {
        out[outPos++] = sym;
        continue;
      }
      if (sym < 256) {
        throw new ZipError(LARGER);
      }
      if (sym === 256) {
        break;
      }
      if (sym > 285) {
        throw new ZipError(BAD_LIT);
      }
      // 25 bits minus a 15-bit code leaves 10: enough for up to 5 length extra bits.
      const lenExtra = LEN_EXTRA[sym - 257];
      const length = LEN_BASE[sym - 257] + (buf & ((1 << lenExtra) - 1));

      buf >>>= lenExtra;
      cnt -= lenExtra;
      while (cnt < 25) {
        buf |= (pos < src.length ? src[pos] : 0) << cnt;
        pos++;
        cnt += 8;
      }
      entry = distFast[buf & distMask];
      if (entry === 0) {
        entry = slowDecode(dist, buf);
      }
      len = entry & 15;
      if (len === 0 || entry >>> 4 > 29) {
        throw new ZipError(BAD_DIST);
      }
      buf >>>= len;
      cnt -= len;
      const distExtra = DIST_EXTRA[entry >>> 4];

      while (cnt < distExtra) {
        buf |= (pos < src.length ? src[pos] : 0) << cnt;
        pos++;
        cnt += 8;
      }
      const distance = DIST_BASE[entry >>> 4] + (buf & ((1 << distExtra) - 1));

      buf >>>= distExtra;
      cnt -= distExtra;
      if (distance > outPos) {
        throw new ZipError('invalid distance too far back');
      }
      if (outPos + length > out.length) {
        throw new ZipError(LARGER);
      }
      // copyWithin is only right when source and target do not overlap; it beats the loop on long copies.
      if (distance >= length && length > 32) {
        out.copyWithin(outPos, outPos - distance, outPos - distance + length);
        outPos += length;
        continue;
      }
      for (let i = 0; i < length; i++, outPos++) {
        out[outPos] = out[outPos - distance];
      }
    }
    this.pos = pos;
    this.buf = buf;
    this.cnt = cnt;
    this.outPos = outPos;
  }
}

/**
 * Decodes a raw DEFLATE stream (RFC 1951) into exactly `size` bytes.
 * Throws ZipError on any malformed stream, or one that does not inflate to exactly `size` bytes.
 * Never writes past `size`, so a declared size caps the memory a zip bomb can take.
 */
export function inflateRaw(src: Uint8Array, size: number): Uint8Array {
  return new Inflater(src, size).run();
}
