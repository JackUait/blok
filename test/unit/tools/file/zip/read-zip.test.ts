import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type * as InflateModule from '../../../../../src/tools/file/zip/inflate';

vi.mock('../../../../../src/tools/file/zip/inflate', async (importOriginal) => {
  const original = await importOriginal<typeof InflateModule>();

  return { ...original, inflateRaw: vi.fn(original.inflateRaw) };
});

import { inflateRaw } from '../../../../../src/tools/file/zip/inflate';
import { DEFAULT_ZIP_LIMITS, readZip } from '../../../../../src/tools/file/zip/read-zip';
import type { ZipArchive } from '../../../../../src/tools/file/zip/read-zip';
import { ZipError } from '../../../../../src/tools/file/zip/zip-error';
import { buildZip, zip64Extra } from './zip-builder';

const ROOT = resolve(__dirname, '../../../../..');
const fixture = (rel: string): Uint8Array => new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/jszip', rel)));
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

const textOf = (archive: ZipArchive, name: string): string => {
  const entry = archive.get(name);

  if (entry === undefined) {
    throw new Error(`no entry ${name}`);
  }

  return new TextDecoder().decode(archive.read(entry));
};

const expectZipError = (fn: () => unknown): void => {
  expect(fn).toThrow(ZipError);
};

const HELLO = 'Hello World\n';
const LOOONG = 'This a looong file : we need to see the difference between the different compression methods.\n';

describe('readZip — upstream JSZip load cases', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('reads a Uint8Array', () => {
    expect(textOf(readZip(fixture('all.zip')), 'Hello.txt')).toBe(HELLO);
  });

  it('reads an ArrayBuffer', () => {
    expect(textOf(readZip(new Uint8Array(fixture('all.zip')).buffer), 'Hello.txt')).toBe(HELLO);
  });

  it('reads a Uint8Array view that does not start at offset 0', () => {
    const bytes = fixture('all.zip');
    const padded = new Uint8Array(bytes.length + 7);

    padded.set(bytes, 7);
    expect(textOf(readZip(padded.subarray(7)), 'Hello.txt')).toBe(HELLO);
  });

  it('read() returns a buffer of its own, not a view into the archive', () => {
    const archive = readZip(fixture('all.zip'));
    const entry = archive.get('Hello.txt');

    expect(entry).toBeDefined();
    if (entry !== undefined) {
      expect(archive.read(entry).buffer.byteLength).toBe(12);
    }
  });

  it('loads entries named like Object.prototype members', () => {
    const archive = readZip(fixture('pollution.zip'));

    expect(textOf(archive, '__proto__')).toBe('hello\n');
    expect(archive.entries.map((e) => e.name).sort()).toEqual(['__proto__', 'constructor', 'toString']);
    expect(archive.get('hasOwnProperty')).toBeUndefined();
  });

  it.each(['deflate.zip', 'deflate-stream.zip', 'store-stream.zip'])('reads the long Hello.txt from %s', (name) => {
    expect(textOf(readZip(fixture(name)), 'Hello.txt')).toBe(LOOONG);
  });

  it.each([
    'archive_comment.zip',
    'extra_attributes.zip',
    'zip64.zip',
    'data_descriptor.zip',
    'all_prepended_bytes.zip',
    'all_appended_bytes.zip',
    'zip64_prepended_bytes.zip',
    'zip64_appended_bytes.zip',
    'all.7zip.zip',
    'all-stream.zip',
  ])('reads Hello.txt from %s', (name) => {
    expect(textOf(readZip(fixture(name)), 'Hello.txt')).toBe(HELLO);
  });

  it.each([
    ['nested.zip', 'zip_within_zip.zip'],
    ['nested_data_descriptor.zip', 'data_descriptor.zip'],
    ['nested_zip64.zip', 'zip64.zip'],
  ])('reads a zip nested in %s', (outer, inner) => {
    const archive = readZip(fixture(outer));
    const entry = archive.get(inner);

    expect(entry).toBeDefined();
    if (entry !== undefined) {
      expect(textOf(readZip(archive.read(entry)), 'Hello.txt')).toBe(HELLO);
    }
  });

  it('decodes a UTF-8 file name', () => {
    expect(textOf(readZip(fixture('utf8_in_name.zip')), '€15.txt')).toBe('€15\n');
  });

  it('ignores the WinRAR Unicode Path extra field (0x7075), unlike JSZip', () => {
    // Known gap: JSZip names this entry "€15.txt" from the extra field. Office never writes it.
    expect(textOf(readZip(fixture('winrar_utf8_in_name.zip')), '_15.txt')).toBe('€15\n');
  });

  it('keeps a backslash inside a name', () => {
    expect(textOf(readZip(fixture('backslash.zip')), 'Hel\\lo.txt')).toBe(HELLO);
  });

  it('takes the name from the local header when the central one has backslashes', () => {
    const archive = readZip(fixture('slashes_and_izarc.zip'));

    expect(archive.entries.map((e) => e.name)).toEqual(['test/Hello.txt']);
    expect(textOf(archive, 'test/Hello.txt')).toBe('Hello world\r\n');
  });

  it('reads the Pile Of Poo name and content', () => {
    const text = 'I\xF1t\xEBrn\xE2ti\xF4n\xE0liz\xE6ti\xF8n☃💩';

    expect(textOf(readZip(fixture('pile_of_poo.zip')), `${text}.txt`)).toBe(text);
  });

  it('decodes a CP866 name as UTF-8, so the Cyrillic name is not found', () => {
    const archive = readZip(fixture('local_encoding_in_name.zip'));

    expect(archive.get('Новая папка/')).toBeUndefined();
    expect(archive.entries).toHaveLength(2);
  });

  it('does not check CRC32', () => {
    expect(() => readZip(fixture('invalid/crc32.zip'))).not.toThrow();
  });

  it('reads an empty archive', () => {
    expect(readZip(fixture('empty.zip')).entries).toEqual([]);
  });

  it('rejects an encrypted entry', () => {
    expectZipError(() => readZip(fixture('encrypted.zip')));
  });

  it.each([
    'invalid/compression.zip',
    'all_missing_bytes.zip',
    'zip64_missing_bytes.zip',
    'invalid/bad_offset.zip',
    'invalid/bad_decompressed_size.zip',
  ])('rejects corrupt %s at load', (name) => {
    expectZipError(() => readZip(fixture(name)));
  });

  it('rejects a file that is not a zip', () => {
    expectZipError(() => readZip(utf8('this is not a zip file')));
  });

  it('rejects a truncated zip', () => {
    expectZipError(() => readZip(utf8('PK\x03\x04\x0A\x00\x00\x00<cut>')));
  });

  it('accepts the non-standard extra fields Android tools write', () => {
    // Same shapes as upstream extra_filed_non_standard.zip (23 MB, not copied):
    // a 3-byte central extra, a lone 4-byte JAR marker, and local zipalign padding.
    const zip = buildZip([
      { name: 'a.txt', data: utf8('a'), centralExtra: new Uint8Array([0, 0, 0]) },
      { name: 'b.txt', data: utf8('b'), centralExtra: new Uint8Array([0xfe, 0xca, 0, 0]) },
      { name: 'c.txt', data: utf8('c'), localExtra: new Uint8Array(7) },
    ]);
    const archive = readZip(zip);

    expect(['a.txt', 'b.txt', 'c.txt'].map((n) => textOf(archive, n))).toEqual(['a', 'b', 'c']);
  });

  it.each([
    ['Franz Kafka - The Metamorphosis.epub', 26, 'mimetype', 'application/epub+zip'],
    ['Outlook2007_Calendar.xps', 15, '[Content_Types].xml', 'application/vnd.ms-package.xps-fixeddocument+xml'],
    ['AntarcticaTemps.xlsx', 17, '[Content_Types].xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'],
    ['AntarcticaTemps.ods', 20, 'META-INF/manifest.xml', 'application/vnd.oasis.opendocument.spreadsheet'],
  ])('reads complex file %s under the default limits', (name, count, part, needle) => {
    const archive = readZip(fixture(`complex_files/${name}`), DEFAULT_ZIP_LIMITS);

    expect(archive.entries).toHaveLength(count);
    expect(textOf(archive, part)).toContain(needle);
  });

  it('reads the epub chapter text', () => {
    const archive = readZip(fixture('complex_files/Franz Kafka - The Metamorphosis.epub'));

    expect(textOf(archive, 'OPS/main0.xml')).toContain('One morning, as Gregor Samsa was waking up from anxious dreams');
  });

  it.each([
    'linux_7z.zip', 'linux_ark.zip', 'linux_file_roller-ubuntu.zip', 'linux_file_roller-xubuntu.zip',
    'linux_zip.zip', 'mac_finder.zip', 'windows_7z.zip', 'windows_compressed_folders.zip',
    'windows_izarc.zip', 'windows_winrar.zip',
  ])('marks folders as dirs in permissions/%s', (name) => {
    const archive = readZip(fixture(`permissions/${name}`));

    for (const entry of archive.entries) {
      expect(entry.dir).toBe(entry.name.endsWith('/'));
    }
  });

  it('reads the unix dirs of permissions/linux_zip.zip', () => {
    const dirs = readZip(fixture('permissions/linux_zip.zip')).entries.filter((e) => e.dir).map((e) => e.name);

    expect(dirs.sort()).toEqual(['dir_500/', 'dir_755/', 'dir_777/']);
  });
});

describe('readZip — names and entries', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('resolves "." and empty segments and lets ".." pop (the zip-slip guard)', () => {
    const archive = readZip(buildZip([
      { name: 'a/./b//c/../d.txt', data: utf8('1') },
      { name: '../../evil.txt', data: utf8('2') },
    ]));

    expect(archive.entries.map((e) => e.name)).toEqual(['a/b/d.txt', 'evil.txt']);
  });

  it('uses the local header name over the central one', () => {
    const archive = readZip(buildZip([{ name: 'central.txt', localName: 'local.txt', data: utf8('x') }]));

    expect(archive.entries.map((e) => e.name)).toEqual(['local.txt']);
  });

  it('decodes names as UTF-8 even without the UTF-8 flag', () => {
    const archive = readZip(buildZip([{ name: 'é.txt', data: utf8('x'), flags: 0 }]));

    expect(archive.entries[0]?.name).toBe('é.txt');
  });

  it('keeps the last of two entries with the same name, in the first one\'s place', () => {
    const archive = readZip(buildZip([
      { name: 'x.txt', data: utf8('first') },
      { name: 'y.txt', data: utf8('y') },
      { name: 'x.txt', data: utf8('second') },
    ]));

    expect(archive.entries.map((e) => e.name)).toEqual(['x.txt', 'y.txt']);
    expect(textOf(archive, 'x.txt')).toBe('second');
  });

  it('marks a dir by its DOS attribute and gives it a trailing slash', () => {
    const archive = readZip(buildZip([{ name: 'folder', externalAttr: 0x10 }]));

    expect(archive.entries).toEqual([{ name: 'folder/', dir: true, size: 0 }]);
  });

  it('marks a dir by its unix mode when made on unix', () => {
    const archive = readZip(buildZip([{ name: 'folder', versionMadeBy: 0x0314, externalAttr: 0o40755 << 16 }]));

    expect(archive.entries[0]).toEqual({ name: 'folder/', dir: true, size: 0 });
  });

  it('marks a name ending in a slash as a dir', () => {
    expect(readZip(buildZip([{ name: 'folder/' }])).entries[0]?.dir).toBe(true);
  });

  it('reads a dir and a zero-size entry as empty without inflating', () => {
    const archive = readZip(buildZip([
      { name: 'folder/' },
      { name: 'empty.bin', method: 8, compressed: new Uint8Array([0xff, 0xff]), size: 0 },
    ]));

    expect(archive.entries.map((e) => archive.read(e).length)).toEqual([0, 0]);
    expect(inflateRaw).not.toHaveBeenCalled();
  });

  it('reports the declared uncompressed size', () => {
    const data = new Uint8Array(1000).fill(7);
    const archive = readZip(buildZip([{ name: 'a.bin', data, method: 8 }]));

    expect(archive.entries[0]?.size).toBe(1000);
    expect(archive.read(archive.entries[0] ?? { name: '', dir: false, size: 0 })).toEqual(data);
  });

  it('rejects an entry from another archive', () => {
    const archive = readZip(buildZip([{ name: 'a.txt', data: utf8('a') }]));

    expectZipError(() => archive.read({ name: 'a.txt', dir: false, size: 1 }));
  });
});

describe('readZip — corrupt structures', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('rejects two central records that point at one local header', () => {
    // Both records resolve to the local name "a.txt", so they would collapse into one entry.
    const zip = buildZip([
      { name: 'a.txt', data: utf8('abc') },
      { name: 'b.txt', localName: 'a.txt', data: utf8('abc'), localOffset: 0 },
    ]);

    expectZipError(() => readZip(zip));
  });

  it('rejects a record whose local header sits inside another record\'s data', () => {
    // A's stored bytes hold a valid local header for b.txt, so only the overlap gives it away.
    const inner = buildZip([{ name: 'b.txt', data: utf8('b') }]);
    const zip = buildZip([
      { name: 'a.txt', data: inner },
      { name: 'b.txt', data: utf8('b'), localOffset: 30 + 'a.txt'.length },
    ]);

    expectZipError(() => readZip(zip));
  });

  it('rejects a stored entry whose sizes differ', () => {
    expectZipError(() => readZip(buildZip([{ name: 'a.txt', data: utf8('abc'), size: 5 }])));
  });

  it('rejects an unknown compression method', () => {
    expectZipError(() => readZip(buildZip([{ name: 'a.txt', data: utf8('abc'), method: 12 }])));
  });

  it('rejects a local header offset past the end', () => {
    expectZipError(() => readZip(buildZip([{ name: 'a.txt', data: utf8('abc'), localOffset: 0x7fffffff }])));
  });

  it('rejects compressed data running past the end', () => {
    expectZipError(() => readZip(buildZip([{ name: 'a.txt', data: utf8('abc'), method: 8, compressedSize: 100000 }])));
  });

  it('rejects an extra field longer than the record', () => {
    const extra = new Uint8Array([0x99, 0x99, 0xff, 0xff]);
    const zip = buildZip([{ name: 'a.txt', data: utf8('abc'), centralExtra: extra }]);

    // Point the central extra length past the end of the buffer.
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const cd = zip.length - 22 - (46 + 5 + 4);

    view.setUint16(cd + 30, 0xffff, true);
    expectZipError(() => readZip(zip));
  });

  it('turns every out-of-bounds read into a ZipError', () => {
    const zip = buildZip([{ name: 'a.txt', data: utf8('abc') }]);

    for (let cut = 1; cut < zip.length; cut++) {
      expectZipError(() => readZip(zip.subarray(0, cut)));
    }
  });

  it('rejects a deflate entry that inflates to a size other than declared', () => {
    const archive = readZip(buildZip([{ name: 'a.txt', data: utf8('hello'), method: 8, size: 3 }]));

    expectZipError(() => archive.read(archive.entries[0] ?? { name: '', dir: false, size: 0 }));
  });
});

describe('readZip — ZIP64 values', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('reads 64-bit sizes and offset from the 0x0001 extra field', () => {
    const data = utf8('zip64 body');
    const zip = buildZip([{
      name: 'a.txt', data, size: 0xffffffff, compressedSize: 0xffffffff, localOffset: 0xffffffff,
      centralExtra: zip64Extra(BigInt(data.length), BigInt(data.length), BigInt(0)),
    }], { zip64: {} });

    expect(textOf(readZip(zip), 'a.txt')).toBe('zip64 body');
  });

  it.each([
    ['a local header offset beyond the buffer', [BigInt(0) + BigInt(10), BigInt(10), BigInt(1) << BigInt(40)]],
    ['a size beyond MAX_SAFE_INTEGER', [BigInt(1) << BigInt(60), BigInt(10), BigInt(0)]],
  ])('rejects %s', (_label, values) => {
    const zip = buildZip([{
      name: 'a.txt', data: utf8('0123456789'), size: 0xffffffff, compressedSize: 0xffffffff, localOffset: 0xffffffff,
      centralExtra: zip64Extra(...values),
    }], { zip64: {} });

    expectZipError(() => readZip(zip));
  });

  it.each([
    ['central directory offset', { cdOffset: BigInt(1) << BigInt(40) }],
    ['central directory size', { cdSize: BigInt(1) << BigInt(62) }],
    ['record count', { records: BigInt(1) << BigInt(62) }],
  ])('rejects a ZIP64 %s beyond the buffer', (_label, zip64) => {
    expectZipError(() => readZip(buildZip([{ name: 'a.txt', data: utf8('a') }], { zip64 })));
  });
});

describe('readZip — limits are checked before any inflate', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('defaults to the pptx-renderer recommended limits', () => {
    expect(DEFAULT_ZIP_LIMITS).toEqual({ maxEntries: 4000, maxEntryBytes: 32 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024 });
  });

  it('rejects too many entries', () => {
    const zip = buildZip(Array.from({ length: 5 }, (_, i) => ({ name: `${i}.txt`, data: utf8('x'), method: 8 })));

    expectZipError(() => readZip(zip, { ...DEFAULT_ZIP_LIMITS, maxEntries: 4 }));
    expect(() => readZip(zip, { ...DEFAULT_ZIP_LIMITS, maxEntries: 5 })).not.toThrow();
    expect(inflateRaw).not.toHaveBeenCalled();
  });

  it('rejects an honest 64 MiB bomb from the header alone', () => {
    const bomb = new Uint8Array(deflateRawSync(new Uint8Array(64 * 1024 * 1024)));
    const zip = buildZip([{ name: 'bomb.bin', method: 8, compressed: bomb, size: 64 * 1024 * 1024 }]);
    const started = performance.now();

    expectZipError(() => readZip(zip));
    expect(performance.now() - started).toBeLessThan(500);
    expect(inflateRaw).not.toHaveBeenCalled();
  });

  it('rejects a total over the limit even when each entry fits', () => {
    const zip = buildZip(['a', 'b', 'c'].map((name) => ({ name, data: new Uint8Array(10), method: 8 })));

    expectZipError(() => readZip(zip, { maxEntries: 10, maxEntryBytes: 10, maxTotalBytes: 25 }));
    expect(() => readZip(zip, { maxEntries: 10, maxEntryBytes: 10, maxTotalBytes: 30 })).not.toThrow();
    expect(inflateRaw).not.toHaveBeenCalled();
  });

  it('stops a lying header at its declared size', () => {
    const real = new Uint8Array(1024 * 1024).fill(1);
    const zip = buildZip([{ name: 'liar.bin', method: 8, compressed: new Uint8Array(deflateRawSync(real)), size: 10 }]);
    const archive = readZip(zip);

    expectZipError(() => archive.read(archive.entries[0] ?? { name: '', dir: false, size: 0 }));
    expect(inflateRaw).toHaveBeenCalledWith(expect.any(Uint8Array), 10);
  });
});

describe('readZip — every Office file in the repo', () => {
  const golden = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/golden/jszip-archives.json'), 'utf8')) as Record<string, unknown>;
  const office = Object.keys(golden).filter((p) => /\.(docx|xlsx|pptx)$/.test(p));

  it('finds the repo samples and fixtures', () => {
    expect(office).toEqual(expect.arrayContaining([
      'public/samples/service-agreement.docx',
      'public/samples/pitch-deck.pptx',
      'public/samples/quarterly-budget.xlsx',
      'test/playwright/fixtures/office/sample.docx',
      'test/playwright/fixtures/office/sample.pptx',
      'test/playwright/fixtures/office/sample.xlsx',
    ]));
  });

  it.each(office)('reads every entry of %s under the default limits', (rel) => {
    const archive = readZip(new Uint8Array(readFileSync(resolve(ROOT, rel))), DEFAULT_ZIP_LIMITS);

    expect(archive.entries.length).toBeGreaterThan(0);
    for (const entry of archive.entries) {
      expect(archive.read(entry)).toHaveLength(entry.size);
    }
  });
});
