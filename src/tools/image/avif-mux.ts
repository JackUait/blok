/**
 * Minimal AVIF (ISOBMFF/MIAF) writer for a single still AV1 image item.
 *
 * Browsers can *decode* AVIF but none of them can encode it through
 * `canvas.convertToBlob` — the only native encoder is WebCodecs' AV1
 * `VideoEncoder`, which outputs raw AV1 OBUs. An AVIF file is exactly one
 * such keyframe wrapped in the boxes below, so a hand-rolled muxer is all
 * that is missing. Everything here is pure byte-shuffling with no DOM.
 */

export interface AvifMuxOptions {
  width: number;
  height: number;
  /** From the AV1 codec string requested from the encoder (av01.P.LLT.DD). */
  seqProfile: number;
  seqLevelIdx: number;
  tier: 0 | 1;
  /** CICP (ISO 23091-2) colour signalling — mirror what the encoder reports. */
  colorPrimaries: number;
  transferCharacteristics: number;
  matrixCoefficients: number;
  fullRange: boolean;
}

const encoder = new TextEncoder();

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);

  parts.reduce((offset, part) => {
    out.set(part, offset);

    return offset + part.length;
  }, 0);

  return out;
}

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);
const u16 = (value: number): Uint8Array => bytes((value >> 8) & 0xff, value & 0xff);
const u32 = (value: number): Uint8Array =>
  bytes((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
const fourCc = (type: string): Uint8Array => encoder.encode(type);

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const body = concat(parts);

  return concat([u32(8 + body.length), fourCc(type), body]);
}

/** ISO "full box": a box whose body starts with version + 24-bit flags. */
function fullBox(type: string, version: number, ...parts: Uint8Array[]): Uint8Array {
  return box(type, bytes(version, 0, 0, 0), ...parts);
}

const PRIMARY_ITEM_ID = 1;

/**
 * Byte offsets used by tests and by the iloc back-patch below are stable
 * because every box here has a fixed size except mdat's payload.
 */
export function buildAvifFile(obuData: Uint8Array, options: AvifMuxOptions): Uint8Array {
  const ftyp = box('ftyp', fourCc('avif'), u32(0), fourCc('avif'), fourCc('mif1'), fourCc('miaf'));
  const meta = metaBox(obuData, options, 0);
  // iloc's extent_offset is absolute in the file: ftyp + meta + mdat header.
  const mdatPayloadOffset = ftyp.length + meta.length + 8;

  return concat([
    ftyp,
    metaBox(obuData, options, mdatPayloadOffset),
    box('mdat', obuData),
  ]);
}

function metaBox(obuData: Uint8Array, options: AvifMuxOptions, payloadOffset: number): Uint8Array {
  const hdlr = fullBox('hdlr', 0, u32(0), fourCc('pict'), u32(0), u32(0), u32(0), bytes(0));
  const pitm = fullBox('pitm', 0, u16(PRIMARY_ITEM_ID));
  const iloc = fullBox(
    'iloc',
    0,
    // offset_size = 4, length_size = 4, base_offset_size = 0
    bytes(0x44, 0x00),
    u16(1), // item_count
    u16(PRIMARY_ITEM_ID),
    u16(0), // data_reference_index — this file
    u16(1), // extent_count
    u32(payloadOffset),
    u32(obuData.length),
  );
  const iinf = fullBox(
    'iinf',
    0,
    u16(1),
    fullBox('infe', 2, u16(PRIMARY_ITEM_ID), u16(0), fourCc('av01'), bytes(0)),
  );

  return fullBox('meta', 0, hdlr, pitm, iloc, iinf, itemPropertiesBox(options));
}

function itemPropertiesBox(options: AvifMuxOptions): Uint8Array {
  const ispe = fullBox('ispe', 0, u32(options.width), u32(options.height));
  // Three 8-bit channels — the WebCodecs path only ever encodes 8-bit 4:2:0.
  const pixi = fullBox('pixi', 0, bytes(3, 8, 8, 8));
  const av1C = box(
    'av1C',
    bytes(
      0x81, // marker + version 1
      ((options.seqProfile & 0b111) << 5) | (options.seqLevelIdx & 0b11111),
      // tier | high_bitdepth | twelve_bit | monochrome | subsampling_x | subsampling_y | sample_position
      (options.tier << 7) | (1 << 3) | (1 << 2),
      0, // no initial_presentation_delay
    ),
  );
  const colr = box(
    'colr',
    fourCc('nclx'),
    u16(options.colorPrimaries),
    u16(options.transferCharacteristics),
    u16(options.matrixCoefficients),
    bytes(options.fullRange ? 0x80 : 0x00),
  );

  const ipco = box('ipco', ispe, pixi, av1C, colr);
  // Associate all four properties with the item; av1C (index 3) is essential.
  const ipma = fullBox('ipma', 0, u32(1), u16(PRIMARY_ITEM_ID), bytes(4), bytes(1, 2, 0x80 | 3, 4));

  return box('iprp', ipco, ipma);
}

const OBU_TEMPORAL_DELIMITER = 2;

/**
 * Drop temporal delimiter OBUs from an encoded AV1 chunk. VideoEncoder
 * prepends one per frame, but an AVIF image item must not contain any.
 * Unknown or size-less trailing OBUs are passed through untouched.
 */
export function stripTemporalDelimiterObus(data: Uint8Array): Uint8Array {
  return concat(collectObus(data, 0, []));
}

/** Unsigned leb128: 7 value bits per byte, high bit is the continuation flag. */
function readLeb128(data: Uint8Array, start: number): { value: number; end: number } {
  const byte = data[start];

  if ((byte & 0x80) === 0) return { value: byte, end: start + 1 };

  const rest = readLeb128(data, start + 1);

  return { value: (byte & 0x7f) | (rest.value << 7), end: rest.end };
}

function collectObus(data: Uint8Array, offset: number, kept: Uint8Array[]): Uint8Array[] {
  if (offset >= data.length) return kept;

  const header = data[offset];
  const type = (header >> 3) & 0x0f;
  const hasExtension = (header >> 2) & 1;
  const hasSize = (header >> 1) & 1;

  if (!hasSize) {
    // Without a size field the OBU runs to the end of the chunk.
    return [...kept, data.subarray(offset)];
  }

  const { value: size, end: payloadStart } = readLeb128(data, offset + 1 + hasExtension);
  const end = payloadStart + size;
  const next = type === OBU_TEMPORAL_DELIMITER ? kept : [...kept, data.subarray(offset, end)];

  return collectObus(data, end, next);
}
