import { describe, it, expect } from 'vitest';

import { buildAvifFile, stripTemporalDelimiterObus, type AvifMuxOptions } from '../../../../src/tools/image/avif-mux';

const OPTIONS: AvifMuxOptions = {
  width: 8,
  height: 8,
  seqProfile: 0,
  seqLevelIdx: 0,
  tier: 0,
  colorPrimaries: 1,
  transferCharacteristics: 1,
  matrixCoefficients: 1,
  fullRange: false,
};

const OBU = Uint8Array.from([0x32, 0x03, 0xaa, 0xbb, 0xcc]);

const readU32 = (data: Uint8Array, at: number): number =>
  ((data[at] << 24) | (data[at + 1] << 16) | (data[at + 2] << 8) | data[at + 3]) >>> 0;

const tagAt = (data: Uint8Array, at: number): string =>
  String.fromCharCode(data[at], data[at + 1], data[at + 2], data[at + 3]);

/**
 * Bytes between a container box header and its first child. Two of these boxes
 * are ISO "full boxes" (version plus 24-bit flags), and iinf carries an entry
 * count on top of that.
 */
const CHILDREN_AT: Record<string, number> = {
  meta: 4,
  iinf: 6,
  iprp: 0,
  ipco: 0,
};

/** Box tree as `type(child,child)`, so a wrong four-character tag shows up by name. */
const shapeOf = (data: Uint8Array, start = 0, end = data.length): string[] => {
  const shapes: string[] = [];
  let at = start;

  while (at + 8 <= end) {
    const size = readU32(data, at);
    const type = tagAt(data, at + 4);

    if (size < 8 || at + size > end) {
      shapes.push(`<${JSON.stringify(type)} claims ${size} bytes>`);
      break;
    }

    const childrenAt = CHILDREN_AT[type];
    const children = childrenAt === undefined ? [] : shapeOf(data, at + 8 + childrenAt, at + size);

    shapes.push(children.length > 0 ? `${type}(${children.join(',')})` : type);
    at += size;
  }

  return shapes;
};

/** Body of the first box with this type, descending only into known containers. */
const bodyOf = (data: Uint8Array, type: string, start = 0, end = data.length): Uint8Array | null => {
  let at = start;

  while (at + 8 <= end) {
    const size = readU32(data, at);

    if (size < 8 || at + size > end) {
      return null;
    }

    const boxType = tagAt(data, at + 4);

    if (boxType === type) {
      return data.subarray(at + 8, at + size);
    }

    const childrenAt = CHILDREN_AT[boxType];
    const nested = childrenAt === undefined ? null : bodyOf(data, type, at + 8 + childrenAt, at + size);

    if (nested !== null) {
      return nested;
    }
    at += size;
  }

  return null;
};

const obus = (...values: number[]): number[] => Array.from(stripTemporalDelimiterObus(Uint8Array.from(values)));

/**
 * Two survivors are equivalent: both mutants of the end-of-data guard in the
 * OBU walk. Reading one byte past the end yields undefined, whose header bits
 * read as zero, so the has-size branch fires and appends an empty slice — the
 * same bytes the guard returned by stopping.
 */
describe('avif-mux mutants', () => {
  describe('the box tree', () => {
    it('nests every box the format requires', () => {
      expect(shapeOf(buildAvifFile(OBU, OPTIONS))).toStrictEqual([
        'ftyp',
        'meta(hdlr,pitm,iloc,iinf(infe),iprp(ipco(ispe,pixi,av1C,colr),ipma))',
        'mdat',
      ]);
    });

    it('declares the avif brand', () => {
      const ftyp = bodyOf(buildAvifFile(OBU, OPTIONS), 'ftyp');

      expect(ftyp).not.toBeNull();
      expect(ftyp === null ? [] : [tagAt(ftyp, 0), tagAt(ftyp, 8), tagAt(ftyp, 12), tagAt(ftyp, 16)])
        .toStrictEqual(['avif', 'avif', 'mif1', 'miaf']);
    });

    it('names the handler as a picture handler', () => {
      const hdlr = bodyOf(buildAvifFile(OBU, OPTIONS), 'hdlr');

      expect(hdlr === null ? null : tagAt(hdlr, 8)).toBe('pict');
    });

    it('names the item type as an AV1 image', () => {
      const infe = bodyOf(buildAvifFile(OBU, OPTIONS), 'infe');

      expect(infe === null ? null : tagAt(infe, 8)).toBe('av01');
    });

    it('carries the payload in mdat', () => {
      const mdat = bodyOf(buildAvifFile(OBU, OPTIONS), 'mdat');

      expect(mdat === null ? [] : Array.from(mdat)).toStrictEqual(Array.from(OBU));
    });
  });

  describe('stripping temporal delimiters', () => {
    it('drops a delimiter and keeps the frame that follows it', () => {
      expect(obus(0x12, 0x00, 0x32, 0x03, 0xaa, 0xbb, 0xcc))
        .toStrictEqual([0x32, 0x03, 0xaa, 0xbb, 0xcc]);
    });

    // Header bit 1 clear means the OBU carries no size field and runs to the end
    // of the chunk. Reading a size there instead swallows the whole tail and
    // then classifies it by the delimiter's own type, dropping everything.
    it('keeps a size-less OBU and everything after it', () => {
      expect(obus(0x10, 0x41, 0x42)).toStrictEqual([0x10, 0x41, 0x42]);
    });

    // The extension byte sits between the header and the size, so skipping it
    // backwards reads the header itself as the length and swallows the
    // delimiter that follows.
    it('skips the extension byte before reading the size', () => {
      expect(obus(0x36, 0xee, 0x02, 0xaa, 0xbb, 0x12, 0x00))
        .toStrictEqual([0x36, 0xee, 0x02, 0xaa, 0xbb]);
    });

    it('returns nothing for an empty chunk', () => {
      expect(obus()).toStrictEqual([]);
    });
  });
});
