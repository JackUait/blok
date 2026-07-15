import { describe, it, expect } from 'vitest';

import {
  buildAvifFile,
  stripTemporalDelimiterObus,
  type AvifMuxOptions,
} from '../../../../src/tools/image/avif-mux';

const td = new TextDecoder();

const readU32 = (data: Uint8Array, offset: number): number =>
  ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;

const boxType = (data: Uint8Array, offset: number): string =>
  td.decode(data.subarray(offset + 4, offset + 8));

/** Walk top-level boxes into { type → [start, size] }. */
const topLevelBoxes = (data: Uint8Array): Map<string, { start: number; size: number }> => {
  const boxes = new Map<string, { start: number; size: number }>();
  let offset = 0;

  while (offset < data.length) {
    const size = readU32(data, offset);

    boxes.set(boxType(data, offset), { start: offset, size });
    offset += size;
  }

  return boxes;
};

/** Depth-first search for the first box of `type` anywhere in the file. */
const findBox = (data: Uint8Array, type: string): number => {
  for (let i = 0; i + 8 <= data.length; i++) {
    if (td.decode(data.subarray(i + 4, i + 8)) === type && readU32(data, i) >= 8) return i;
  }

  return -1;
};

const makeOptions = (overrides: Partial<AvifMuxOptions> = {}): AvifMuxOptions => ({
  width: 640,
  height: 480,
  seqProfile: 0,
  seqLevelIdx: 8,
  tier: 0,
  colorPrimaries: 1,
  transferCharacteristics: 13,
  matrixCoefficients: 1,
  fullRange: false,
  ...overrides,
});

/** A fake payload standing in for AV1 OBUs — the muxer must treat it as opaque bytes. */
const obuPayload = (): Uint8Array => Uint8Array.from([0x0a, 0x0b, 0x0c, 0x0d, 0x0e]);

describe('buildAvifFile', () => {
  it('lays out ftyp, meta and mdat as the top-level boxes, in that order', () => {
    const file = buildAvifFile(obuPayload(), makeOptions());
    const boxes = topLevelBoxes(file);

    expect([...boxes.keys()]).toEqual(['ftyp', 'meta', 'mdat']);
    expect(boxes.get('ftyp')?.start).toBe(0);
  });

  it('declares the avif major brand with mif1/miaf compatibility', () => {
    const file = buildAvifFile(obuPayload(), makeOptions());
    const ftypBody = td.decode(file.subarray(8, readU32(file, 0)));

    expect(ftypBody.startsWith('avif')).toBe(true);
    expect(ftypBody).toContain('mif1');
    expect(ftypBody).toContain('miaf');
  });

  it('stores the OBU payload as the mdat body', () => {
    const payload = obuPayload();
    const file = buildAvifFile(payload, makeOptions());
    const mdat = topLevelBoxes(file).get('mdat');

    expect(mdat).toBeDefined();
    if (!mdat) return;
    expect(mdat.size).toBe(8 + payload.length);
    expect([...file.subarray(mdat.start + 8, mdat.start + mdat.size)]).toEqual([...payload]);
  });

  it('points iloc at the mdat payload with its exact length', () => {
    const payload = obuPayload();
    const file = buildAvifFile(payload, makeOptions());
    const iloc = findBox(file, 'iloc');
    const mdat = topLevelBoxes(file).get('mdat');

    expect(iloc).toBeGreaterThan(-1);
    expect(mdat).toBeDefined();
    if (!mdat) return;

    // iloc v0 layout: header(8) + version/flags(4) + sizes(2) + item_count(2)
    // + item_id(2) + data_reference_index(2) + extent_count(2) → extent_offset u32, extent_length u32
    const extentOffset = readU32(file, iloc + 22);
    const extentLength = readU32(file, iloc + 26);

    expect(extentOffset).toBe(mdat.start + 8);
    expect(extentLength).toBe(payload.length);
  });

  it('writes the image dimensions into ispe', () => {
    const file = buildAvifFile(obuPayload(), makeOptions({ width: 1920, height: 1080 }));
    const ispe = findBox(file, 'ispe');

    expect(readU32(file, ispe + 12)).toBe(1920);
    expect(readU32(file, ispe + 16)).toBe(1080);
  });

  it('encodes profile, level, tier and 4:2:0 subsampling into av1C', () => {
    const file = buildAvifFile(obuPayload(), makeOptions({ seqProfile: 0, seqLevelIdx: 8, tier: 0 }));
    const av1C = findBox(file, 'av1C');

    // marker(1) | version(7) = 0x81
    expect(file[av1C + 8]).toBe(0x81);
    // seq_profile(3) | seq_level_idx(5)
    expect(file[av1C + 9]).toBe((0 << 5) | 8);
    // tier(1) hbd(1) 12bit(1) mono(1) csx(1) csy(1) sample_pos(2) → 4:2:0 = 0b0000_1100
    expect(file[av1C + 10]).toBe(0b0000_1100);
  });

  it('writes the requested nclx colour signalling into colr', () => {
    const file = buildAvifFile(
      obuPayload(),
      makeOptions({ colorPrimaries: 1, transferCharacteristics: 13, matrixCoefficients: 6, fullRange: true }),
    );
    const colr = findBox(file, 'colr');

    expect(td.decode(file.subarray(colr + 8, colr + 12))).toBe('nclx');
    expect((file[colr + 12] << 8) | file[colr + 13]).toBe(1);
    expect((file[colr + 14] << 8) | file[colr + 15]).toBe(13);
    expect((file[colr + 16] << 8) | file[colr + 17]).toBe(6);
    expect(file[colr + 18]).toBe(0x80);
  });

  it('keeps every declared box size consistent with the actual bytes', () => {
    const file = buildAvifFile(obuPayload(), makeOptions());
    const boxes = topLevelBoxes(file);
    const total = [...boxes.values()].reduce((sum, b) => sum + b.size, 0);

    expect(total).toBe(file.length);
  });
});

describe('stripTemporalDelimiterObus', () => {
  // OBU header byte: forbidden(1) type(4) extension(1) has_size(1) reserved(1)
  const obu = (type: number, payload: number[]): number[] => [
    (type << 3) | 0b010, // has_size_field set
    payload.length,
    ...payload,
  ];

  it('removes a leading temporal delimiter and keeps the rest byte-identical', () => {
    const sequenceHeader = obu(1, [0xaa, 0xbb]);
    const frame = obu(6, [0xcc]);
    const data = Uint8Array.from([...obu(2, []), ...sequenceHeader, ...frame]);

    const stripped = stripTemporalDelimiterObus(data);

    expect([...stripped]).toEqual([...sequenceHeader, ...frame]);
  });

  it('returns the input unchanged when there is no temporal delimiter', () => {
    const data = Uint8Array.from([...obu(1, [0x01]), ...obu(6, [0x02, 0x03])]);

    expect([...stripTemporalDelimiterObus(data)]).toEqual([...data]);
  });

  it('handles multi-byte leb128 OBU sizes', () => {
    const bigPayload = new Array(200).fill(0x55);
    // 200 fits in one leb128 byte with the continuation bit clear? No: 200 > 127 → two bytes.
    const frame = [(6 << 3) | 0b010, 0xc8, 0x01, ...bigPayload];
    const data = Uint8Array.from([...frame, ...[(2 << 3) | 0b010, 0x00]]);

    const stripped = stripTemporalDelimiterObus(data);

    expect([...stripped]).toEqual(frame);
  });

  it('keeps a trailing OBU without a size field as-is', () => {
    const noSize = [(6 << 3) | 0b000, 0xde, 0xad];
    const data = Uint8Array.from([...obu(2, []), ...noSize]);

    expect([...stripTemporalDelimiterObus(data)]).toEqual(noSize);
  });
});
