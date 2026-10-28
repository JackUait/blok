// Derived from @aiden0z/pptx-renderer 1.4.0 (Apache-2.0); modified for Blok. See NOTICE.
/* eslint-disable no-restricted-syntax, max-depth -- vendored upstream code: restyling it risks behaviour the parity suite cannot see */
/**
 * EMF (Enhanced Metafile) binary parser — extracts embedded content from EMF files.
 *
 * PPTX files frequently embed EMF images as OLE object previews.
 * Most contain embedded PDF data inside GDI comment records, or DIB bitmaps
 * via STRETCHDIBITS records. This parser extracts the bitmaps without
 * implementing full EMF record interpretation. A PDF cannot be drawn here,
 * so an EMF that carries one is reported as unsupported.
 *
 * EMF record format: each record is { type: u32, size: u32, ...data }
 * Records are walked sequentially until EOF record (type 14).
 */

export type EmfContent =
  | { type: 'bitmap'; imageData: ImageData }
  | { type: 'empty' }
  | { type: 'unsupported' };

// EMF record types
const EMR_EOF = 14;
const EMR_COMMENT = 70;
const EMR_STRETCHDIBITS = 81;

// GDI comment identifiers (MS-EMF spec)
const GDIC_COMMENT_ID = 0x43494447; // "GDIC"
const GDIC_BEGINGROUP = 0x00000002;
const GDIC_MULTIFORMATS = 0x40000004;

// EMF header signature at offset 40
const EMF_SIGNATURE = 0x464d4520; // " EMF"

// PDF marker
const PDF_HEADER = [0x25, 0x50, 0x44, 0x46]; // "%PDF"

// DIB compression
const BI_RGB = 0;
const MAX_EMF_BITMAP_PIXELS = 16_777_216;

/**
 * Parse an EMF file and extract its embedded content.
 */
export function parseEmfContent(data: Uint8Array): EmfContent {
  if (data.length < 44) return { type: 'unsupported' };

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // Validate EMF signature at offset 40
  if (view.getUint32(40, true) !== EMF_SIGNATURE) {
    return { type: 'unsupported' };
  }

  let offset = 0;
  let recordCount = 0;

  while (offset + 8 <= data.length) {
    const recordType = view.getUint32(offset, true);
    const recordSize = view.getUint32(offset + 4, true);

    // Sanity check record size
    if (recordSize < 8 || offset + recordSize > data.length) break;

    recordCount++;

    if (recordType === EMR_EOF) break;

    // A PDF comment ends the walk: a bitmap after it is not drawn.
    if (recordType === EMR_COMMENT && recordSize > 16 && hasGdiCommentPdf(data, view, offset, recordSize)) {
      return { type: 'unsupported' };
    }

    // Check STRETCHDIBITS for embedded bitmaps
    if (recordType === EMR_STRETCHDIBITS && recordSize > 80) {
      const result = parseStretchDibits(data, view, offset, recordSize);
      if (result) return result;
    }

    offset += recordSize;
  }

  // Only HEADER + EOF → empty
  if (recordCount <= 2) {
    return { type: 'empty' };
  }

  return { type: 'unsupported' };
}

/**
 * Check a GDI Comment record for embedded PDF data.
 */
function hasGdiCommentPdf(
  data: Uint8Array,
  view: DataView,
  offset: number,
  recordSize: number,
): boolean {
  // Record layout: type(4) + size(4) + cbData(4) + commentId(4) + ...
  if (offset + 16 > data.length) return false;

  const commentId = view.getUint32(offset + 12, true);

  if (commentId === GDIC_COMMENT_ID && offset + 20 <= data.length) {
    const publicType = view.getUint32(offset + 16, true);

    if (publicType === GDIC_BEGINGROUP) {
      // Search for %PDF signature in the record data
      if (containsPdf(data.subarray(offset + 8, offset + recordSize))) return true;
    }

    if (publicType === GDIC_MULTIFORMATS && offset + 24 <= data.length) {
      if (hasMultiformatsPdf(data, view, offset)) return true;
    }
  }

  // Also search non-GDIC comments for raw PDF data
  return recordSize > 100 && containsPdf(data.subarray(offset + 8, offset + recordSize));
}

/**
 * Check a MULTIFORMATS GDI comment's format descriptors for embedded PDF data.
 */
function hasMultiformatsPdf(data: Uint8Array, view: DataView, offset: number): boolean {
  // Layout from record start:
  // +12: commentIdentifier(4), +16: publicCommentIdentifier(4)
  // +20: outputRect(16 = RECTL)
  // +36: countFormats(4)
  // +40: format descriptors array, each: { signature(4), version(4), cbData(4), offData(4) }
  if (offset + 40 > data.length) return false;

  const countFormats = view.getUint32(offset + 36, true);
  const descriptorStart = offset + 40;

  for (let i = 0; i < countFormats && i < 10; i++) {
    const descOff = descriptorStart + i * 16;
    if (descOff + 16 > data.length) break;

    const cbData = view.getUint32(descOff + 8, true);
    const offData = view.getUint32(descOff + 12, true);

    // offData is relative to the start of the record
    const dataStart = offset + offData;
    if (dataStart + cbData > data.length || cbData === 0) continue;

    if (containsPdf(data.subarray(dataStart, dataStart + cbData))) return true;
  }

  return false;
}

function containsPdf(buf: Uint8Array): boolean {
  return findSequence(buf, PDF_HEADER) !== -1;
}

/**
 * Parse a STRETCHDIBITS record and extract the bitmap as ImageData.
 */
function parseStretchDibits(
  data: Uint8Array,
  view: DataView,
  offset: number,
  _recordSize: number,
): EmfContent | null {
  // STRETCHDIBITS record layout (offsets from record start):
  //   0: type(4), 4: size(4)
  //   8: rclBounds (16 bytes)
  //  24: xDest(4), 28: yDest(4)
  //  32: xSrc(4), 36: ySrc(4)
  //  40: cxSrc(4), 44: cySrc(4)
  //  48: offBmiSrc(4), 52: cbBmiSrc(4)
  //  56: offBitsSrc(4), 60: cbBitsSrc(4)
  //  64: iUsageSrc(4), 68: dwRop(4)
  //  72: cxDest(4), 76: cyDest(4)
  if (offset + 80 > data.length) return null;

  const offBmiSrc = view.getUint32(offset + 48, true);
  const cbBmiSrc = view.getUint32(offset + 52, true);
  const offBitsSrc = view.getUint32(offset + 56, true);
  const cbBitsSrc = view.getUint32(offset + 60, true);

  if (cbBmiSrc === 0 || cbBitsSrc === 0) return null;

  const bmiStart = offset + offBmiSrc;
  if (bmiStart + 40 > data.length) return null;

  // Parse BITMAPINFOHEADER
  const biWidth = view.getInt32(bmiStart + 4, true);
  const biHeight = view.getInt32(bmiStart + 8, true);
  const biBitCount = view.getUint16(bmiStart + 14, true);
  const biCompression = view.getUint32(bmiStart + 16, true);

  // Only support uncompressed RGB bitmaps
  if (biCompression !== BI_RGB) return null;
  if (biBitCount !== 24 && biBitCount !== 32) return null;

  const width = Math.abs(biWidth);
  const height = Math.abs(biHeight);
  if (width === 0 || height === 0 || width > 8192 || height > 8192) return null;
  if (width * height > MAX_EMF_BITMAP_PIXELS) return null;

  const bitsStart = offset + offBitsSrc;
  if (bitsStart + cbBitsSrc > data.length) return null;

  const bytesPerPixel = biBitCount / 8;
  // DIB rows are padded to 4-byte boundaries.
  const rowStride = Math.ceil((width * bytesPerPixel) / 4) * 4;
  const requiredBits = rowStride * height;
  if (cbBitsSrc < requiredBits) return null;

  const bitsData = data.subarray(bitsStart, bitsStart + requiredBits);

  // Negative height means top-down row order; positive means bottom-up
  const topDown = biHeight < 0;

  const imageData = new ImageData(width, height);

  for (let y = 0; y < height; y++) {
    const srcRow = topDown ? y : height - 1 - y;
    const srcOffset = srcRow * rowStride;
    const dstOffset = y * width * 4;

    for (let x = 0; x < width; x++) {
      const srcIdx = srcOffset + x * bytesPerPixel;
      if (srcIdx + bytesPerPixel > bitsData.length) break;

      // DIB stores BGR(A)
      imageData.data[dstOffset + x * 4 + 0] = bitsData[srcIdx + 2]; // R
      imageData.data[dstOffset + x * 4 + 1] = bitsData[srcIdx + 1]; // G
      imageData.data[dstOffset + x * 4 + 2] = bitsData[srcIdx + 0]; // B
      imageData.data[dstOffset + x * 4 + 3] = biBitCount === 32 ? bitsData[srcIdx + 3] : 255;
    }
  }

  return { type: 'bitmap', imageData };
}

/**
 * Find the first occurrence of a byte sequence in a buffer.
 */
function findSequence(buf: Uint8Array, seq: number[]): number {
  const end = buf.length - seq.length;
  for (let i = 0; i <= end; i++) {
    if (matchesAt(buf, i, seq)) return i;
  }
  return -1;
}

/**
 * Check if buffer matches a byte sequence at a given offset.
 */
function matchesAt(buf: Uint8Array, offset: number, seq: number[]): boolean {
  for (let j = 0; j < seq.length; j++) {
    if (buf[offset + j] !== seq[j]) return false;
  }
  return true;
}
