// Writes the PDF fixtures for file-pdf-preview.spec.ts. The spec imports
// manyPagesPdf to build its large file at run time instead of committing it.
// Run from the repo root: node test/playwright/fixtures/pdf/make-fixtures.mjs
// Output is byte-stable: rerunning it must leave git clean.
// No import.meta: Playwright loads this file as CommonJS when the spec imports it.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'test/playwright/fixtures/pdf');
const ID = Buffer.from('426c6f6b2050444620666978747572', 'hex');

/** Padding from the PDF spec's standard security handler (algorithm 2). */
const PAD = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');

function rc4(key, data) {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[n] = data[n] ^ s[(s[i] + s[j]) & 255];
  }

  return out;
}

const md5 = (...parts) => createHash('md5').update(Buffer.concat(parts)).digest();
const padded = (password) => Buffer.concat([Buffer.from(password, 'latin1'), PAD]).subarray(0, 32);

/** RC4 40-bit, revision 2: the simplest handler pdf.js reads. */
function standardSecurity(userPassword, ownerPassword) {
  const permissions = -4;
  const owner = rc4(md5(padded(ownerPassword)).subarray(0, 5), padded(userPassword));
  const p = Buffer.alloc(4);
  p.writeInt32LE(permissions);
  const key = md5(padded(userPassword), owner, p, ID).subarray(0, 5);
  const user = rc4(key, PAD);
  const objectKey = (num) => {
    const salt = Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0]);

    return md5(key, salt).subarray(0, key.length + 5);
  };

  return {
    dict: `<< /Filter /Standard /V 1 /R 2 /O <${owner.toString('hex')}> /U <${user.toString('hex')}> /P ${permissions} >>`,
    encrypt: (num, data) => rc4(objectKey(num), data),
  };
}

const stream = (dict, data) => ({ dict, data: Buffer.from(data, 'latin1') });

/**
 * Builds a PDF from objects numbered from 1. An object is a string, or a
 * stream `{ dict, data }`. Object 1 is the catalog.
 */
function buildPdf(objects, security = null) {
  const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let length = chunks[0].length;
  const offsets = [];
  const push = (data) => {
    const buffer = typeof data === 'string' ? Buffer.from(data, 'latin1') : data;
    chunks.push(buffer);
    length += buffer.length;
  };
  objects.forEach((object, index) => {
    const num = index + 1;
    offsets.push(length);
    push(`${num} 0 obj\n`);
    if (typeof object === 'string') {
      push(`${object}\n`);
    } else {
      const data = security !== null && object.encrypt !== false ? security.encrypt(num, object.data) : object.data;
      push(`<< ${object.dict} /Length ${data.length} >>\nstream\n`);
      push(data);
      push('\nendstream\n');
    }
    push('endobj\n');
  });
  const extra = security === null ? [] : [security.dict];
  const encryptRef = security === null ? '' : ` /Encrypt ${objects.length + 1} 0 R`;
  extra.forEach((object, index) => {
    offsets.push(length);
    push(`${objects.length + index + 1} 0 obj\n${object}\nendobj\n`);
  });
  const xref = length;
  const count = offsets.length + 1;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  offsets.forEach((offset) => push(`${String(offset).padStart(10, '0')} 00000 n \n`));
  const id = `<${ID.toString('hex')}>`;
  push(`trailer\n<< /Size ${count} /Root 1 0 R${encryptRef} /ID [${id} ${id}] >>\nstartxref\n${xref}\n%%EOF\n`);

  return Buffer.concat(chunks);
}

const FONT = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
const text = (lines) => lines.map(([x, y, size, words]) => `BT /F1 ${size} Tf ${x} ${y} Td (${words}) Tj ET`).join('\n');

/**
 * Three Letter pages, each titled "Blok PDF page N". Page 1 links out to
 * example.com and down to page 3.
 */
function textPdf() {
  const pageNums = [3, 5, 7];
  const page = (num, contents, annots = '') =>
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 10 0 R >> >> /Contents ${contents} 0 R${annots} >>`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count 3 >>`,
    page(3, 4, ' /Annots [8 0 R 9 0 R]'),
    stream('', text([
      [72, 700, 28, 'Blok PDF page 1'],
      [72, 640, 16, 'Blok website'],
      [72, 600, 16, 'Go to page 3'],
    ])),
    page(5, 6),
    stream('', text([[72, 700, 28, 'Blok PDF page 2']])),
    page(7, 11),
    '<< /Type /Annot /Subtype /Link /Rect [70 634 180 654] /Border [0 0 0] /A << /S /URI /URI (https://example.com/blok) >> >>',
    '<< /Type /Annot /Subtype /Link /Rect [70 594 180 614] /Border [0 0 0] /Dest [7 0 R /XYZ 0 792 null] >>',
    FONT,
    stream('', text([[72, 700, 28, 'Blok PDF page 3']])),
  ];

  return buildPdf(objects);
}

/** One page, user password "blok". */
function passwordPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    stream('', text([[72, 700, 28, 'Blok secret page']])),
    FONT,
  ];

  return buildPdf(objects, standardSecurity('blok', 'blok-owner'));
}

/**
 * Japanese in a font the file does not carry, as many Japanese writers make
 * it: pdf.js needs the 90ms-RKSJ-H cmap to read the bytes. The text is
 * 日本語テスト in Shift-JIS.
 */
function cjkPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    stream('', 'BT /F1 72 Tf 72 600 Td <93fa967b8cea836583588367> Tj ET'),
    '<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiMin-W3 /Encoding /90ms-RKSJ-H /DescendantFonts [6 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiMin-W3 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> /FontDescriptor 7 0 R /DW 1000 >>',
    '<< /Type /FontDescriptor /FontName /HeiseiMin-W3 /Flags 6 /FontBBox [-123 -257 1001 910] /ItalicAngle 0 /Ascent 723 /Descent -241 /CapHeight 709 /StemV 69 >>',
  ];

  return buildPdf(objects);
}

/** A PDF header over bytes that are no PDF at all. */
const corruptPdf = () => Buffer.from('%PDF-1.7\nthis file was cut off before any object\n', 'latin1');

/**
 * `count` Letter pages titled "Blok PDF page N", each padded with `padding`
 * bytes of comment, so the file spans several 1 MiB server chunks. The page
 * objects come first and the contents after, as most writers lay them out:
 * pdf.js reads every page object on open (it checks the last page).
 */
export function manyPagesPdf(count, padding) {
  const filler = `${'% padding '.repeat(Math.ceil(padding / 10)).slice(0, padding - 1)}\n`;
  const pageRef = (index) => 3 + index;
  const contentRef = (index) => 3 + count + index;
  const fontRef = 3 + 2 * count;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: count }, (_, i) => `${pageRef(i)} 0 R`).join(' ')}] /Count ${count} >>`,
  ];
  for (let i = 0; i < count; i++) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontRef} 0 R >> >> /Contents ${contentRef(i)} 0 R >>`);
  }
  for (let i = 0; i < count; i++) {
    objects.push(stream('', `${filler}${text([[72, 700, 28, `Blok PDF page ${i + 1}`]])}`));
  }
  objects.push(FONT);

  return buildPdf(objects);
}

if (process.argv[1]?.endsWith('make-fixtures.mjs')) {
  writeFileSync(join(OUT, 'three-pages.pdf'), textPdf());
  writeFileSync(join(OUT, 'password-blok.pdf'), passwordPdf());
  writeFileSync(join(OUT, 'corrupt.pdf'), corruptPdf());
  writeFileSync(join(OUT, 'japanese-no-font.pdf'), cjkPdf());
}
