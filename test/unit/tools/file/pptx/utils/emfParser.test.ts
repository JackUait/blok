// Derived from @aiden0z/pptx-renderer 1.4.0 tests (Apache-2.0); modified for Blok.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../helpers/domShims';
import { parseEmfContent } from '../../../../../../src/tools/file/pptx/utils/emfParser';

// ---------------------------------------------------------------------------
// Helpers to build synthetic EMF binary data
// ---------------------------------------------------------------------------

/** Write a little-endian uint32 into a buffer. */
function writeU32(buf: Uint8Array, offset: number, value: number): void {
  new DataView(buf.buffer, buf.byteOffset, buf.byteLength).setUint32(offset, value, true);
}

/** Write a little-endian int32 into a buffer. */
function writeI32(buf: Uint8Array, offset: number, value: number): void {
  writeU32(buf, offset, value >>> 0);
}

/** Write a little-endian uint16 into a buffer. */
function writeU16(buf: Uint8Array, offset: number, value: number): void {
  new DataView(buf.buffer, buf.byteOffset, buf.byteLength).setUint16(offset, value, true);
}

const EMF_SIGNATURE = 0x464d4520;
const EMR_HEADER = 1;
const EMR_EOF = 14;
const EMR_COMMENT = 70;
const EMR_STRETCHDIBITS = 81;
const GDIC_ID = 0x43494447;
const MULTIFORMATS_TYPE = 0x40000004;
const BEGINGROUP_TYPE = 0x00000002;

/** Minimal PDF data for testing — just enough to be recognized. */
const MINI_PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF');

/**
 * Build a minimal EMF header record (type=1).
 * Only the signature at offset 40 matters for validation.
 */
function buildEmfHeader(headerSize = 108): Uint8Array {
  const buf = new Uint8Array(headerSize);
  writeU32(buf, 0, EMR_HEADER);    // type
  writeU32(buf, 4, headerSize);     // size
  writeU32(buf, 40, EMF_SIGNATURE); // signature " EMF"
  return buf;
}

/** Build an EMR_EOF record. */
function buildEofRecord(): Uint8Array {
  const buf = new Uint8Array(20);
  writeU32(buf, 0, EMR_EOF);
  writeU32(buf, 4, 20);
  return buf;
}

/**
 * Build a GDI Comment record with MULTIFORMATS containing embedded PDF.
 * Mirrors the structure observed in real-world EMF files:
 *   +0:  type(4) + size(4)
 *   +8:  cbData(4)
 *   +12: commentIdentifier = GDIC (4)
 *   +16: publicCommentIdentifier = 0x40000004 (4)
 *   +20: outputRect (16 = RECTL)
 *   +36: countFormats(4)
 *   +40: EmrFormat { signature(4), version(4), cbData(4), offData(4) }
 *   +56: [format data: 12 bytes preamble + PDF bytes]
 */
function buildMultiformatsPdfComment(pdfData: Uint8Array): Uint8Array {
  const preambleSize = 12; // preamble before %PDF in format data, as observed in real files
  const formatDataSize = preambleSize + pdfData.length;
  const offData = 56; // offset from record start to format data area

  // Record: header(8) + cbData(4) + commentId(4) + publicType(4) + outputRect(16) + countFormats(4) + descriptor(16) + formatData
  const recordSize = offData + formatDataSize;
  // Pad to 4-byte boundary
  const paddedSize = Math.ceil(recordSize / 4) * 4;
  const buf = new Uint8Array(paddedSize);

  writeU32(buf, 0, EMR_COMMENT);         // type
  writeU32(buf, 4, paddedSize);           // size
  writeU32(buf, 8, paddedSize - 8);       // cbData
  writeU32(buf, 12, GDIC_ID);            // commentIdentifier
  writeU32(buf, 16, MULTIFORMATS_TYPE);   // publicCommentIdentifier
  // outputRect at +20..+35: leave as zeros
  writeU32(buf, 36, 1);                  // countFormats = 1

  // Format descriptor at +40
  writeU32(buf, 40, 0x50444620);          // signature = "PDF " (little-endian)
  writeU32(buf, 44, 1);                   // version
  writeU32(buf, 48, formatDataSize);      // cbData
  writeU32(buf, 52, offData);             // offData (relative to record start)

  // Format data at +56: preamble + PDF
  buf.set(pdfData, offData + preambleSize);

  return buf;
}

/**
 * Build a MULTIFORMATS GDI Comment whose descriptor points at non-PDF data.
 */
function buildMultiformatsNonPdfComment(): Uint8Array {
  const payload = new TextEncoder().encode('not a pdf payload');
  const offData = 56;
  const recordSize = Math.ceil((offData + payload.length) / 4) * 4;
  const buf = new Uint8Array(recordSize);

  writeU32(buf, 0, EMR_COMMENT);
  writeU32(buf, 4, recordSize);
  writeU32(buf, 8, recordSize - 8);
  writeU32(buf, 12, GDIC_ID);
  writeU32(buf, 16, MULTIFORMATS_TYPE);
  writeU32(buf, 36, 1);
  writeU32(buf, 40, 0x50444620);
  writeU32(buf, 44, 1);
  writeU32(buf, 48, payload.length);
  writeU32(buf, 52, offData);
  buf.set(payload, offData);

  return buf;
}

/**
 * Build a GDI Comment record with BEGINGROUP containing embedded PDF.
 */
function buildBegingroupPdfComment(pdfData: Uint8Array): Uint8Array {
  // Simpler structure: just embed PDF somewhere in the record data
  const dataStart = 20; // 8 (header) + 4 (cbData) + 4 (commentId) + 4 (publicType)
  const recordSize = Math.ceil((dataStart + pdfData.length) / 4) * 4;
  const buf = new Uint8Array(recordSize);

  writeU32(buf, 0, EMR_COMMENT);
  writeU32(buf, 4, recordSize);
  writeU32(buf, 8, recordSize - 8);
  writeU32(buf, 12, GDIC_ID);
  writeU32(buf, 16, BEGINGROUP_TYPE);
  buf.set(pdfData, dataStart);

  return buf;
}

/**
 * Build an EMR_COMMENT with raw (non-GDIC) PDF data — tests the brute-force fallback.
 */
function buildRawPdfComment(pdfData: Uint8Array): Uint8Array {
  const dataStart = 12; // 8 (header) + 4 (cbData)
  const recordSize = Math.ceil((dataStart + pdfData.length) / 4) * 4;
  const buf = new Uint8Array(recordSize);

  writeU32(buf, 0, EMR_COMMENT);
  writeU32(buf, 4, recordSize);
  writeU32(buf, 8, recordSize - 8);
  // commentIdentifier is just the first 4 bytes of data — NOT GDIC
  buf.set(pdfData, dataStart);

  return buf;
}

/**
 * Build an EMR_STRETCHDIBITS record with a small uncompressed 24-bit bitmap.
 */
function buildStretchDibitsRecord(width: number, height: number, bpp: 24 | 32): Uint8Array {
  const bytesPerPixel = bpp / 8;
  const rowStride = Math.ceil((width * bytesPerPixel) / 4) * 4;
  const bitmapDataSize = rowStride * height;
  const bmiSize = 40; // BITMAPINFOHEADER

  const offBmiSrc = 80; // standard offset after STRETCHDIBITS fields
  const offBitsSrc = offBmiSrc + bmiSize;
  const recordSize = offBitsSrc + bitmapDataSize;
  const paddedSize = Math.ceil(recordSize / 4) * 4;
  const buf = new Uint8Array(paddedSize);

  // EMR header
  writeU32(buf, 0, EMR_STRETCHDIBITS);
  writeU32(buf, 4, paddedSize);

  // STRETCHDIBITS fields
  writeU32(buf, 48, offBmiSrc);
  writeU32(buf, 52, bmiSize);
  writeU32(buf, 56, offBitsSrc);
  writeU32(buf, 60, bitmapDataSize);

  // BITMAPINFOHEADER at offBmiSrc
  writeU32(buf, offBmiSrc, 40);          // biSize
  writeI32(buf, offBmiSrc + 4, width);   // biWidth
  writeI32(buf, offBmiSrc + 8, height);  // biHeight (positive = bottom-up)
  writeU16(buf, offBmiSrc + 12, 1);      // biPlanes
  writeU16(buf, offBmiSrc + 14, bpp);    // biBitCount
  writeU32(buf, offBmiSrc + 16, 0);      // biCompression = BI_RGB

  // Bitmap pixel data: fill with a recognizable pattern
  // Row 0 (bottom in bottom-up): red, Row 1: green, etc.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = offBitsSrc + y * rowStride + x * bytesPerPixel;
      // BGR format; 32 bpp adds alpha
      const pixel = [(y * 50) & 0xff, (x * 50) & 0xff, 255, ...(bpp === 32 ? [200] : [])];
      buf.set(pixel, idx);
    }
  }

  return buf;
}

/**
 * Build an EMR_STRETCHDIBITS record whose header declares a large bitmap but
 * whose pixel payload is intentionally too short for those dimensions.
 */
function buildTruncatedStretchDibitsRecord(width: number, height: number, bpp: 24 | 32): Uint8Array {
  const bmiSize = 40;
  const offBmiSrc = 80;
  const offBitsSrc = offBmiSrc + bmiSize;
  const cbBitsSrc = 4;
  const recordSize = offBitsSrc + cbBitsSrc;
  const buf = new Uint8Array(recordSize);

  writeU32(buf, 0, EMR_STRETCHDIBITS);
  writeU32(buf, 4, recordSize);
  writeU32(buf, 48, offBmiSrc);
  writeU32(buf, 52, bmiSize);
  writeU32(buf, 56, offBitsSrc);
  writeU32(buf, 60, cbBitsSrc);

  writeU32(buf, offBmiSrc, 40);
  writeI32(buf, offBmiSrc + 4, width);
  writeI32(buf, offBmiSrc + 8, height);
  writeU16(buf, offBmiSrc + 12, 1);
  writeU16(buf, offBmiSrc + 14, bpp);
  writeU32(buf, offBmiSrc + 16, 0);

  return buf;
}

/** Concatenate multiple Uint8Arrays. */
function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseEmfContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validation', () => {
    it('returns unsupported for data too small', () => {
      const result = parseEmfContent(new Uint8Array(10));
      expect(result.type).toBe('unsupported');
    });

    it('returns unsupported for invalid EMF signature', () => {
      const buf = new Uint8Array(100);
      writeU32(buf, 0, EMR_HEADER);
      writeU32(buf, 4, 80);
      writeU32(buf, 40, 0xdeadbeef); // wrong signature
      const result = parseEmfContent(buf);
      expect(result.type).toBe('unsupported');
    });
  });

  describe('empty EMF', () => {
    it('returns empty for header + EOF only', () => {
      const emf = concat(buildEmfHeader(), buildEofRecord());
      const result = parseEmfContent(emf);
      expect(result.type).toBe('empty');
    });
  });

  // The renderer cannot draw an embedded PDF, so a PDF-bearing EMF is unsupported.
  describe('embedded PDF', () => {
    it('treats a GDIC MULTIFORMATS comment with a PDF as unsupported', () => {
      const emf = concat(buildEmfHeader(), buildMultiformatsPdfComment(MINI_PDF), buildEofRecord());

      expect(parseEmfContent(emf)).toEqual({ type: 'unsupported' });
    });

    it('treats a PDF without %%EOF as unsupported', () => {
      const pdfNoEof = new TextEncoder().encode('%PDF-1.4\nsome content');
      const emf = concat(buildEmfHeader(), buildMultiformatsPdfComment(pdfNoEof), buildEofRecord());

      expect(parseEmfContent(emf)).toEqual({ type: 'unsupported' });
    });

    it('continues when MULTIFORMATS descriptors contain no PDF payload', () => {
      const emf = concat(buildEmfHeader(), buildMultiformatsNonPdfComment(), buildEofRecord());

      expect(parseEmfContent(emf)).toEqual({ type: 'unsupported' });
    });

    it('treats a GDIC BEGINGROUP comment with a PDF as unsupported', () => {
      const emf = concat(buildEmfHeader(), buildBegingroupPdfComment(MINI_PDF), buildEofRecord());

      expect(parseEmfContent(emf)).toEqual({ type: 'unsupported' });
    });

    it('treats a large non-GDIC comment with a PDF as unsupported', () => {
      // The raw scan only looks at records over 100 bytes.
      const paddedPdf = new Uint8Array(120);
      paddedPdf.set(MINI_PDF, 40);
      const emf = concat(buildEmfHeader(), buildRawPdfComment(paddedPdf), buildEofRecord());

      expect(parseEmfContent(emf)).toEqual({ type: 'unsupported' });
    });

    it('returns unsupported for large non-GDIC comments without a PDF marker', () => {
      const raw = new Uint8Array(140);
      raw.fill(0x41);
      const emf = concat(buildEmfHeader(), buildRawPdfComment(raw), buildEofRecord());

      expect(parseEmfContent(emf)).toEqual({ type: 'unsupported' });
    });

    it('stops at the PDF comment and ignores a bitmap that follows it', () => {
      const emf = concat(
        buildEmfHeader(),
        buildMultiformatsPdfComment(MINI_PDF),
        buildStretchDibitsRecord(4, 3, 24),
        buildEofRecord(),
      );

      expect(parseEmfContent(emf)).toEqual({ type: 'unsupported' });
    });
  });

  describe('bitmap extraction via STRETCHDIBITS', () => {
    it('rejects bitmap records whose payload is shorter than the declared dimensions', () => {
      const dib = buildTruncatedStretchDibitsRecord(512, 512, 24);
      const emf = concat(buildEmfHeader(), dib, buildEofRecord());

      const result = parseEmfContent(emf);

      expect(result.type).not.toBe('bitmap');
    });

    it('extracts 24-bit uncompressed bitmap', () => {
      const dib = buildStretchDibitsRecord(4, 3, 24);
      const emf = concat(buildEmfHeader(), dib, buildEofRecord());

      const result = parseEmfContent(emf);
      expect(result.type).toBe('bitmap');
      if (result.type === 'bitmap') {
        expect(result.imageData.width).toBe(4);
        expect(result.imageData.height).toBe(3);
        // Alpha should be 255 for 24-bit
        expect(result.imageData.data[3]).toBe(255);
      }
    });

    it('extracts 32-bit uncompressed bitmap with alpha', () => {
      const dib = buildStretchDibitsRecord(3, 2, 32);
      const emf = concat(buildEmfHeader(), dib, buildEofRecord());

      const result = parseEmfContent(emf);
      expect(result.type).toBe('bitmap');
      if (result.type === 'bitmap') {
        expect(result.imageData.width).toBe(3);
        expect(result.imageData.height).toBe(2);
        // Alpha should come from source (200)
        expect(result.imageData.data[3]).toBe(200);
      }
    });

    it('handles bottom-up row order (positive biHeight)', () => {
      const dib = buildStretchDibitsRecord(2, 2, 24);
      const emf = concat(buildEmfHeader(), dib, buildEofRecord());

      const result = parseEmfContent(emf);
      expect(result.type).toBe('bitmap');
      if (result.type === 'bitmap') {
        // Bottom-up: row 0 in DIB = last row in ImageData
        // Row 1 in DIB (y=1) has B=(1*50)&0xff=50
        // In ImageData row 0 (top), pixel (0,0) B channel = imageData[2] (since it's mapped to R in output)
        // Actually: DIB BGR → ImageData RGBA
        // DIB row y=1 (top in bottom-up → becomes ImageData row 0):
        //   B=50, G=0, R=255 → ImageData: R=255, G=0, B=50, A=255
        const r = result.imageData.data[0];
        const g = result.imageData.data[1];
        const b = result.imageData.data[2];
        expect(r).toBe(255);
        expect(g).toBe(0);
        expect(b).toBe(50);
      }
    });

    it('handles top-down row order (negative biHeight)', () => {
      // Build a custom STRETCHDIBITS with negative height
      const width = 2, height = 2, bpp = 24;
      const bytesPerPixel = 3;
      const rowStride = Math.ceil((width * bytesPerPixel) / 4) * 4;
      const bitmapDataSize = rowStride * height;
      const bmiSize = 40;
      const offBmiSrc = 80;
      const offBitsSrc = offBmiSrc + bmiSize;
      const recordSize = Math.ceil((offBitsSrc + bitmapDataSize) / 4) * 4;
      const rec = new Uint8Array(recordSize);

      writeU32(rec, 0, EMR_STRETCHDIBITS);
      writeU32(rec, 4, recordSize);
      writeU32(rec, 48, offBmiSrc);
      writeU32(rec, 52, bmiSize);
      writeU32(rec, 56, offBitsSrc);
      writeU32(rec, 60, bitmapDataSize);

      writeU32(rec, offBmiSrc, 40);
      writeI32(rec, offBmiSrc + 4, width);
      writeI32(rec, offBmiSrc + 8, -height); // negative = top-down
      writeU16(rec, offBmiSrc + 12, 1);
      writeU16(rec, offBmiSrc + 14, bpp);
      writeU32(rec, offBmiSrc + 16, 0);

      // Row 0: B=0, G=0, R=100
      rec[offBitsSrc + 0] = 0;   // B
      rec[offBitsSrc + 1] = 0;   // G
      rec[offBitsSrc + 2] = 100; // R

      const emf = concat(buildEmfHeader(), rec, buildEofRecord());
      const result = parseEmfContent(emf);
      expect(result.type).toBe('bitmap');
      if (result.type === 'bitmap') {
        // Top-down: row 0 in DIB = row 0 in ImageData
        expect(result.imageData.data[0]).toBe(100); // R
        expect(result.imageData.data[1]).toBe(0);   // G
        expect(result.imageData.data[2]).toBe(0);    // B
      }
    });
  });

  describe('priority', () => {
    it('returns bitmap when no PDF is present', () => {
      const dib = buildStretchDibitsRecord(2, 2, 24);
      const emf = concat(buildEmfHeader(), dib, buildEofRecord());

      const result = parseEmfContent(emf);
      expect(result.type).toBe('bitmap');
    });
  });

  describe('unsupported cases', () => {
    it('returns unsupported for EMF with only drawing records', () => {
      // Build a record with type 17 (EMR_SETMAPMODE) — a drawing record
      const drawRecord = new Uint8Array(12);
      writeU32(drawRecord, 0, 17); // type
      writeU32(drawRecord, 4, 12); // size
      writeU32(drawRecord, 8, 1);  // data

      const emf = concat(buildEmfHeader(), drawRecord, buildEofRecord());
      const result = parseEmfContent(emf);
      expect(result.type).toBe('unsupported');
    });
  });

  describe('EMF+ dual mode', () => {
    it('skips EMF+ comment and still finds the PDF in a later GDIC comment', () => {
      // First comment: EMF+ identifier (0x2B464D45)
      const emfPlusComment = new Uint8Array(24);
      writeU32(emfPlusComment, 0, EMR_COMMENT);
      writeU32(emfPlusComment, 4, 24);
      writeU32(emfPlusComment, 8, 16);
      writeU32(emfPlusComment, 12, 0x2b464d45); // "EMF+"

      // Second comment: GDIC with PDF
      const pdfComment = buildMultiformatsPdfComment(MINI_PDF);
      // The bitmap after the PDF shows the walk stopped at the PDF.
      const dib = buildStretchDibitsRecord(2, 2, 24);
      const emf = concat(buildEmfHeader(), emfPlusComment, pdfComment, dib, buildEofRecord());

      expect(parseEmfContent(emf)).toEqual({ type: 'unsupported' });
    });
  });

  describe('edge cases', () => {
    it('handles Uint8Array that is a subarray of a larger buffer', () => {
      const dib = buildStretchDibitsRecord(2, 2, 24);
      const emf = concat(buildEmfHeader(), dib, buildEofRecord());

      // Wrap in a larger buffer and create a subarray
      const padded = new Uint8Array(emf.length + 100);
      padded.set(emf, 50);
      const subarray = padded.subarray(50, 50 + emf.length);

      const result = parseEmfContent(subarray);
      expect(result.type).toBe('bitmap');
    });

    it('handles corrupted record size gracefully', () => {
      const emf = concat(buildEmfHeader(), buildEofRecord());
      // Corrupt the EOF record size to be too large
      writeU32(emf, emf.length - 20 + 4, 999999);

      // Should not crash — just return based on records seen
      const result = parseEmfContent(emf);
      // Only header seen before bad record → empty (recordCount=1, then break)
      expect(result.type).toBe('empty');
    });
  });
});
