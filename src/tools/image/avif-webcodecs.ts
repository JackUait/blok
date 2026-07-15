import { buildAvifFile, stripTemporalDelimiterObus } from './avif-mux';

/**
 * AVIF encoding through WebCodecs. No browser can encode AVIF via
 * `canvas.convertToBlob` — it silently returns PNG — but Chromium ships a
 * native AV1 encoder behind `VideoEncoder`. A still AVIF is a single AV1
 * keyframe in an ISOBMFF wrapper, so: encode one frame, strip the temporal
 * delimiter, mux (see avif-mux.ts). Every unsupported or degenerate case
 * returns null so the caller can fall through to the next encode target.
 */

// Minimal structural types for the WebCodecs surface we use (avoids relying on
// lib.dom types that may not be present in the project's TS target).
interface EncodedChunkLike {
  type: string;
  byteLength: number;
  copyTo(dest: Uint8Array): void;
}

interface VideoColorSpaceLike {
  primaries?: string | null;
  transfer?: string | null;
  matrix?: string | null;
  fullRange?: boolean | null;
}

interface ChunkMetadataLike {
  decoderConfig?: { colorSpace?: VideoColorSpaceLike };
}

interface VideoFrameLike { close(): void; }

interface VideoFrameCtor {
  new (source: unknown, init: { timestamp: number }): VideoFrameLike;
}

interface VideoEncoderLike {
  configure(config: Record<string, unknown>): void;
  encode(frame: VideoFrameLike, options?: Record<string, unknown>): void;
  flush(): Promise<void>;
  close(): void;
}

interface VideoEncoderCtor {
  new (init: {
    output: (chunk: EncodedChunkLike, meta?: ChunkMetadataLike) => void;
    error: (err: unknown) => void;
  }): VideoEncoderLike;
  isConfigSupported(config: Record<string, unknown>): Promise<{ supported?: boolean }>;
}

/**
 * AV1 levels that can hold a still image, smallest first.
 * MaxPicSize is in samples; MaxHSize/MaxVSize bound each dimension.
 */
const AV1_LEVELS: Array<{ idx: number; maxPicSize: number; maxWidth: number; maxHeight: number }> = [
  { idx: 0, maxPicSize: 147_456, maxWidth: 2048, maxHeight: 1152 }, // 2.0
  { idx: 1, maxPicSize: 278_784, maxWidth: 2816, maxHeight: 1584 }, // 2.1
  { idx: 4, maxPicSize: 552_960, maxWidth: 4352, maxHeight: 2448 }, // 3.0
  { idx: 5, maxPicSize: 983_040, maxWidth: 5504, maxHeight: 3096 }, // 3.1
  { idx: 8, maxPicSize: 2_359_296, maxWidth: 6144, maxHeight: 3456 }, // 4.0
  { idx: 12, maxPicSize: 8_912_896, maxWidth: 8192, maxHeight: 4352 }, // 5.0
  { idx: 16, maxPicSize: 35_651_584, maxWidth: 16384, maxHeight: 8704 }, // 6.0
];

/** Smallest AV1 level whose limits fit the frame, or null when none does. */
export function pickSeqLevelIdx(width: number, height: number): number | null {
  const level = AV1_LEVELS.find(
    (l) => width * height <= l.maxPicSize && width <= l.maxWidth && height <= l.maxHeight,
  );

  return level?.idx ?? null;
}

/** Canvas-style quality (0..1, higher is better) → AV1 quantizer (0..63, lower is better). */
export function qualityToQuantizer(quality: number): number {
  return Math.round((1 - Math.min(Math.max(quality, 0), 1)) * 63);
}

// CICP (ISO 23091-2) codes for the colour names WebCodecs reports.
const PRIMARIES_CODE: Record<string, number> = { 'bt709': 1, 'bt470bg': 5, 'smpte170m': 6 };
const TRANSFER_CODE: Record<string, number> = { 'bt709': 1, 'smpte170m': 6, 'iec61966-2-1': 13 };
const MATRIX_CODE: Record<string, number> = { 'rgb': 0, 'bt709': 1, 'bt470bg': 5, 'smpte170m': 6 };

/** Chromium converts RGB frames as BT.709 limited range — the observed default. */
const FALLBACK_COLOR = { colorPrimaries: 1, transferCharacteristics: 1, matrixCoefficients: 1, fullRange: false };

function colorSignalling(colorSpace: VideoColorSpaceLike | undefined): typeof FALLBACK_COLOR {
  if (!colorSpace) return FALLBACK_COLOR;

  return {
    colorPrimaries: PRIMARIES_CODE[colorSpace.primaries ?? ''] ?? FALLBACK_COLOR.colorPrimaries,
    transferCharacteristics:
      TRANSFER_CODE[colorSpace.transfer ?? ''] ?? FALLBACK_COLOR.transferCharacteristics,
    matrixCoefficients: MATRIX_CODE[colorSpace.matrix ?? ''] ?? FALLBACK_COLOR.matrixCoefficients,
    fullRange: colorSpace.fullRange ?? FALLBACK_COLOR.fullRange,
  };
}

function webCodecs(): { Encoder: VideoEncoderCtor; Frame: VideoFrameCtor } | null {
  const g = globalThis as Record<string, unknown>;

  if (typeof g.VideoEncoder !== 'function' || typeof g.VideoFrame !== 'function') return null;
  if (typeof g.OffscreenCanvas !== 'function') return null;

  return { Encoder: g.VideoEncoder as VideoEncoderCtor, Frame: g.VideoFrame as VideoFrameCtor };
}

interface DrawnFrame { canvas: OffscreenCanvas; opaque: boolean }

function drawOpaqueCheck(
  bitmap: ImageBitmap,
  size: { width: number; height: number },
): DrawnFrame | null {
  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d');

  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);

  const pixels = ctx.getImageData(0, 0, size.width, size.height).data;
  const translucent = pixels.some((value, index) => index % 4 === 3 && value !== 255);

  return { canvas, opaque: !translucent };
}

const codecString = (seqLevelIdx: number): string =>
  `av01.0.${String(seqLevelIdx).padStart(2, '0')}M.08`;

/**
 * Encode a bitmap as a still AVIF via WebCodecs' AV1 encoder.
 *
 * Returns null whenever the caller should try the next target instead:
 * WebCodecs or AV1 quantizer mode unavailable, the frame exceeds AV1 level
 * 5.0, the image has transparency (a single-item AVIF has no alpha plane),
 * or the encoder fails.
 */
export async function encodeAvifWithVideoEncoder(
  bitmap: ImageBitmap,
  size: { width: number; height: number },
  quality: number,
): Promise<Blob | null> {
  const codecs = webCodecs();

  if (!codecs) return null;

  const seqLevelIdx = pickSeqLevelIdx(size.width, size.height);

  if (seqLevelIdx === null) return null;

  const codec = codecString(seqLevelIdx);
  const config = {
    codec,
    width: size.width,
    height: size.height,
    bitrateMode: 'quantizer',
    latencyMode: 'quality',
  };

  try {
    const { supported } = await codecs.Encoder.isConfigSupported(config);

    if (!supported) return null;

    const drawn = drawOpaqueCheck(bitmap, size);

    if (!drawn || !drawn.opaque) return null;

    const encoded = await encodeSingleFrame(codecs, config, drawn.canvas, quality);

    if (!encoded) return null;

    const obuData = stripTemporalDelimiterObus(encoded.data);
    const file = buildAvifFile(obuData, {
      width: size.width,
      height: size.height,
      seqProfile: 0,
      seqLevelIdx,
      tier: 0,
      ...colorSignalling(encoded.colorSpace),
    });

    return new Blob([file.buffer as ArrayBuffer], { type: 'image/avif' });
  } catch {
    return null;
  }
}

interface EncodedFrame { data: Uint8Array; colorSpace?: VideoColorSpaceLike }

async function encodeSingleFrame(
  codecs: { Encoder: VideoEncoderCtor; Frame: VideoFrameCtor },
  config: Record<string, unknown>,
  canvas: OffscreenCanvas,
  quality: number,
): Promise<EncodedFrame | null> {
  const captured: {
    chunk: EncodedChunkLike | null;
    colorSpace: VideoColorSpaceLike | undefined;
    failure: unknown;
  } = { chunk: null, colorSpace: undefined, failure: null };

  const encoder = new codecs.Encoder({
    output: (encodedChunk, meta) => {
      captured.chunk ??= encodedChunk;
      captured.colorSpace ??= meta?.decoderConfig?.colorSpace;
    },
    error: (err) => { captured.failure = err; },
  });
  const frame = new codecs.Frame(canvas, { timestamp: 0 });

  try {
    encoder.configure(config);
    encoder.encode(frame, { keyFrame: true, av1: { quantizer: qualityToQuantizer(quality) } });
    await encoder.flush();
  } catch {
    return null;
  } finally {
    frame.close();
    try {
      encoder.close();
    } catch {
      // Already closed after an encoder error — nothing to release.
    }
  }

  if (captured.failure || !captured.chunk) return null;

  const data = new Uint8Array(captured.chunk.byteLength);

  captured.chunk.copyTo(data);

  return { data, colorSpace: captured.colorSpace };
}
