import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type * as InflateModule from '../../../../../src/tools/file/zip/inflate';

vi.mock('../../../../../src/tools/file/zip/inflate', async (importOriginal) => {
  const original = await importOriginal<typeof InflateModule>();

  return { ...original, inflateRaw: vi.fn(original.inflateRaw) };
});

import { inflateRaw } from '../../../../../src/tools/file/zip/inflate';
import JSZipShim from '../../../../../src/tools/file/zip/jszip-shim';
import type { ShimFile, ShimZip } from '../../../../../src/tools/file/zip/jszip-shim';
import { ZipError } from '../../../../../src/tools/file/zip/zip-error';
import { buildZip } from './zip-builder';

const fixture = (rel: string): Uint8Array => new Uint8Array(readFileSync(resolve(__dirname, 'fixtures', rel)));
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

const fileOf = (zip: ShimZip, name: string): ShimFile => {
  const file = zip.file(name);

  if (file === null) {
    throw new Error(`no file ${name}`);
  }

  return file;
};

describe('jszip-shim', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it.each([
    ['Uint8Array', (b: Uint8Array): Uint8Array | ArrayBuffer | Blob => b],
    ['ArrayBuffer', (b: Uint8Array): Uint8Array | ArrayBuffer | Blob => new Uint8Array(b).buffer],
    ['Blob', (b: Uint8Array): Uint8Array | ArrayBuffer | Blob => new Blob([new Uint8Array(b)])],
  ])('loads a %s', async (_label, wrap) => {
    const zip = await JSZipShim.loadAsync(wrap(fixture('jszip/all.zip')));

    await expect(fileOf(zip, 'Hello.txt').async('string')).resolves.toBe('Hello World\n');
  });

  it('keeps files on a null-prototype object', async () => {
    const zip = await JSZipShim.loadAsync(fixture('jszip/pollution.zip'));

    expect(Object.getPrototypeOf(zip.files)).toBeNull();
    expect(Object.keys(zip.files).sort()).toEqual(['__proto__', 'constructor', 'toString']);
    await expect(fileOf(zip, '__proto__').async('string')).resolves.toBe('hello\n');
    expect(zip.file('hasOwnProperty')).toBeNull();
  });

  it('exposes name, dir and _data.uncompressedSize before anything is inflated', async () => {
    const data = new Uint8Array(500).fill(3);
    const zip = await JSZipShim.loadAsync(buildZip([{ name: 'a.bin', data, method: 8 }, { name: 'd/' }]));

    expect(inflateRaw).not.toHaveBeenCalled();
    expect(zip.files['a.bin']).toMatchObject({ name: 'a.bin', dir: false, _data: { uncompressedSize: 500 } });
    expect(zip.files['d/']).toMatchObject({ name: 'd/', dir: true, _data: { uncompressedSize: 0 } });
  });

  it('lists dirs in files but file() returns null for a dir or a missing name', async () => {
    const zip = await JSZipShim.loadAsync(buildZip([{ name: 'd/' }, { name: 'd/a.txt', data: utf8('a') }]));

    expect(Object.keys(zip.files)).toEqual(['d/', 'd/a.txt']);
    expect(zip.file('d/')).toBeNull();
    expect(zip.file('missing')).toBeNull();
    expect(zip.file('d/a.txt')?.name).toBe('d/a.txt');
  });

  it('returns each output type as its own buffer', async () => {
    const zip = await JSZipShim.loadAsync(fixture('jszip/all.zip'));
    const file = fileOf(zip, 'Hello.txt');
    const arraybuffer = await file.async('arraybuffer');
    const uint8array = await file.async('uint8array');
    const blob = await file.async('blob');

    expect(arraybuffer).toBeInstanceOf(ArrayBuffer);
    expect(arraybuffer.byteLength).toBe(12);
    expect(uint8array).toBeInstanceOf(Uint8Array);
    expect(uint8array.buffer.byteLength).toBe(12);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('');
    await expect(blob.text()).resolves.toBe('Hello World\n');
    await expect(file.async('text')).resolves.toBe('Hello World\n');
  });

  it('gives a fresh copy on every read', async () => {
    const zip = await JSZipShim.loadAsync(fixture('jszip/deflate.zip'));
    const file = fileOf(zip, 'Hello.txt');
    const first = await file.async('uint8array');

    first.fill(0);
    await expect(file.async('string')).resolves.toContain('looong');
  });

  it('rejects an unsupported output type', async () => {
    const zip = await JSZipShim.loadAsync(fixture('jszip/all.zip'));

    await expect(fileOf(zip, 'Hello.txt').async('base64')).rejects.toThrow(ZipError);
  });

  it('rejects a bad archive with a ZipError', async () => {
    await expect(JSZipShim.loadAsync(utf8('not a zip'))).rejects.toThrow(ZipError);
  });

  it('rejects an entry that fails to inflate when it is read', async () => {
    const zip = await JSZipShim.loadAsync(buildZip([{ name: 'a.txt', data: utf8('hello'), method: 8, size: 3 }]));

    await expect(fileOf(zip, 'a.txt').async('string')).rejects.toThrow(ZipError);
  });

  it('does not support writing', async () => {
    const zip = await JSZipShim.loadAsync(fixture('jszip/all.zip'));

    expect(() => zip.file('new.txt', 'x')).toThrow(/not supported/);
    await expect(zip.generateAsync({ type: 'blob' })).rejects.toThrow(/not supported/);
  });

  it('keeps a UTF-8 BOM in text, like JSZip', async () => {
    const zip = await JSZipShim.loadAsync(fixture('text/text-decoding.zip'));

    await expect(fileOf(zip, 'bom.txt').async('string')).resolves.toBe('﻿hi\n');
  });

  it('decodes invalid UTF-8 the way the browser JSZip build does', async () => {
    const zip = await JSZipShim.loadAsync(fixture('text/text-decoding.zip'));
    const text = await fileOf(zip, 'invalid.txt').async('string');

    // Captured from jszip/dist/jszip.min.js with no Buffer global.
    expect([...text].map((c) => c.codePointAt(0))).toEqual([
      0x41, 0x0, 0x0, 0x2082, 0xd800, 0xfffd, 0x43, 0xfffd, 0xfffd,
    ]);
  });
});
