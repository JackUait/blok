import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Encoder } from '../../../../../src/components/modules/collaboration/wire-encoding';
import { WireReader } from '../../../helpers/wire-reader';

const encode = (write: (encoder: Encoder) => void): Uint8Array => {
  const encoder = new Encoder();

  write(encoder);

  return encoder.toUint8Array();
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('wire-encoding', () => {
  // lib0's testGolangBinaryEncodingCompatibility: same bytes as Go's binary.PutUvarint.
  it.each([
    [0, [0]],
    [1, [1]],
    [128, [128, 1]],
    [200, [200, 1]],
    [32, [32]],
    [500, [244, 3]],
    [256, [128, 2]],
    [700, [188, 5]],
    [1024, [128, 8]],
    [1025, [129, 8]],
    [4048, [208, 31]],
    [5050, [186, 39]],
    [1000000, [192, 132, 61]],
    [34951959, [151, 166, 213, 16]],
    [2147483646, [254, 255, 255, 255, 7]],
    [2147483647, [255, 255, 255, 255, 7]],
    [2147483648, [128, 128, 128, 128, 8]],
    [2147483700, [180, 128, 128, 128, 8]],
    [4294967294, [254, 255, 255, 255, 15]],
    [4294967295, [255, 255, 255, 255, 15]],
  ])('writes varuint %i as %j', (value, bytes) => {
    expect(Array.from(encode((encoder) => encoder.writeVarUint(value)))).toEqual(bytes);
  });

  it('writes the largest safe integer in eight bytes and reads it back', () => {
    const bytes = encode((encoder) => encoder.writeVarUint(Number.MAX_SAFE_INTEGER));

    expect(Array.from(bytes)).toEqual([255, 255, 255, 255, 255, 255, 255, 15]);
    expect(new WireReader(bytes).readVarUint()).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('round-trips varuints across every byte-length boundary', () => {
    const values = [0, 127, 128, 16383, 16384, 2 ** 21 - 1, 2 ** 21, 2 ** 28, 2 ** 31, 2 ** 32, 2 ** 35, 2 ** 53 - 1];

    for (const value of values) {
      expect(new WireReader(encode((encoder) => encoder.writeVarUint(value))).readVarUint()).toBe(value);
    }
  });

  // lib0's testStringEncoding.
  it.each(['hello', 'test!', '☺☺☺', '', '1234', '쾟', '龟', '😝'])('round-trips the string %j as UTF-8', (text) => {
    const bytes = encode((encoder) => encoder.writeVarString(text));
    const utf8 = new TextEncoder().encode(text);

    expect(Array.from(bytes)).toEqual([...encode((encoder) => encoder.writeVarUint(utf8.length)), ...utf8]);
    expect(new WireReader(bytes).readVarString()).toBe(text);
  });

  it('writes a lone surrogate as U+FFFD, the way lib0 does', () => {
    const bytes = encode((encoder) => encoder.writeVarString('a\u{d83d}b'));

    expect(Array.from(bytes)).toEqual([5, 0x61, 0xef, 0xbf, 0xbd, 0x62]);
  });

  // lib0's testOverflowStringDecoding.
  it('round-trips a string longer than any first buffer', () => {
    const text = '🚧abé'.repeat(4000);

    expect(new WireReader(encode((encoder) => encoder.writeVarString(text))).readVarString()).toBe(text);
  });

  // lib0's testWriteUint8ArrayOverflow.
  it('keeps every byte when a write overflows the buffer', () => {
    const payload = Uint8Array.from({ length: 70_000 }, (_, index) => index % 256);
    const bytes = encode((encoder) => {
      encoder.writeVarUint(7);
      encoder.writeVarUint8Array(payload);
      encoder.writeVarUint(42);
    });
    const reader = new WireReader(bytes);

    expect(reader.readVarUint()).toBe(7);
    expect(reader.readVarUint8Array()).toEqual(payload);
    expect(reader.readVarUint()).toBe(42);
    expect(reader.hasContent()).toBe(false);
  });

  it('keeps every byte across many small writes', () => {
    const bytes = encode((encoder) => {
      for (let value = 0; value < 50_000; value += 1) {
        encoder.writeVarUint(value);
      }
    });
    const reader = new WireReader(bytes);

    for (let value = 0; value < 50_000; value += 1) {
      expect(reader.readVarUint()).toBe(value);
    }

    expect(reader.hasContent()).toBe(false);
  });

  it('returns an owned copy exactly the size of the frame', () => {
    const bytes = encode((encoder) => encoder.writeVarString('frame'));

    expect(bytes.byteOffset).toBe(0);
    expect(bytes.buffer.byteLength).toBe(bytes.length);
    expect(bytes.length).toBe(6);
  });

  it('is not changed by writes after it was taken', () => {
    const encoder = new Encoder();

    encoder.writeVarUint(1);
    const first = encoder.toUint8Array();

    encoder.writeVarUint(2);

    expect(Array.from(first)).toEqual([1]);
    expect(Array.from(encoder.toUint8Array())).toEqual([1, 2]);
  });

  it('writes nothing for a fresh encoder', () => {
    expect(encode(() => undefined)).toEqual(new Uint8Array(0));
  });
});
