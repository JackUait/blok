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
  const file = zip.files[name];

  if (file === undefined) {
    throw new Error(`no file ${name}`);
  }

  return file;
};

describe('jszip-shim', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it.each([
    ['Uint8Array', (b: Uint8Array): Uint8Array | ArrayBuffer => b],
    ['ArrayBuffer', (b: Uint8Array): Uint8Array | ArrayBuffer => new Uint8Array(b).buffer],
  ])('loads a %s', async (_label, wrap) => {
    const zip = await JSZipShim.loadAsync(wrap(fixture('jszip/all.zip')));

    await expect(fileOf(zip, 'Hello.txt').async('string')).resolves.toBe('Hello World\n');
  });

  it('keeps files on a null-prototype object', async () => {
    const zip = await JSZipShim.loadAsync(fixture('jszip/pollution.zip'));

    expect(Object.getPrototypeOf(zip.files)).toBeNull();
    expect(Object.keys(zip.files).sort()).toEqual(['__proto__', 'constructor', 'toString']);
    await expect(fileOf(zip, '__proto__').async('string')).resolves.toBe('hello\n');
    expect(zip.files.hasOwnProperty).toBeUndefined();
  });

  it('exposes name, dir and _data.uncompressedSize before anything is inflated', async () => {
    const data = new Uint8Array(500).fill(3);
    const zip = await JSZipShim.loadAsync(buildZip([{ name: 'a.bin', data, method: 8 }, { name: 'd/' }]));

    expect(inflateRaw).not.toHaveBeenCalled();
    expect(zip.files['a.bin']).toMatchObject({ name: 'a.bin', dir: false, _data: { uncompressedSize: 500 } });
    expect(zip.files['d/']).toMatchObject({ name: 'd/', dir: true, _data: { uncompressedSize: 0 } });
  });

  it('lists dirs in files, flagged so pptx-renderer skips them', async () => {
    const zip = await JSZipShim.loadAsync(buildZip([{ name: 'd/' }, { name: 'd/a.txt', data: utf8('a') }]));

    expect(Object.entries(zip.files).map(([name, file]) => [name, file.dir])).toEqual([['d/', true], ['d/a.txt', false]]);
  });

  it('returns the two output types pptx-renderer asks for', async () => {
    const zip = await JSZipShim.loadAsync(fixture('jszip/all.zip'));
    const file = fileOf(zip, 'Hello.txt');
    const uint8array = await file.async('uint8array');

    await expect(file.async('string')).resolves.toBe('Hello World\n');
    expect(uint8array).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(uint8array)).toBe('Hello World\n');
  });

  it.each(['blob', 'text', 'arraybuffer', 'base64', 'STRING'])('rejects output type %s, which no consumer asks for', async (type) => {
    const zip = await JSZipShim.loadAsync(fixture('jszip/all.zip'));

    const untyped = fileOf(zip, 'Hello.txt').async as (type: string) => Promise<unknown>;

    await expect(untyped(type)).rejects.toThrow(ZipError);
  });

  it('rejects a bad archive with a ZipError', async () => {
    await expect(JSZipShim.loadAsync(utf8('not a zip'))).rejects.toThrow(ZipError);
  });

  it('rejects an entry that fails to inflate when it is read', async () => {
    const zip = await JSZipShim.loadAsync(buildZip([{ name: 'a.txt', data: utf8('hello'), method: 8, size: 3 }]));

    await expect(fileOf(zip, 'a.txt').async('string')).rejects.toThrow(ZipError);
  });

  it('keeps a UTF-8 BOM in text, like JSZip', async () => {
    const zip = await JSZipShim.loadAsync(fixture('text/text-decoding.zip'));

    await expect(fileOf(zip, 'bom.txt').async('string')).resolves.toBe('﻿hi\n');
  });

  it('decodes invalid UTF-8 to U+FFFD like TextDecoder, not into NULs and lone surrogates like JSZip', async () => {
    const zip = await JSZipShim.loadAsync(fixture('text/text-decoding.zip'));
    const text = await fileOf(zip, 'invalid.txt').async('string');

    expect([...text].map((c) => c.codePointAt(0))).toEqual([
      0x41, 0xfffd, 0xfffd, 0xfffd, 0xfffd, 0x42, 0xfffd, 0xfffd, 0xfffd, 0xfffd, 0xfffd,
      0xfffd, 0xfffd, 0xfffd, 0x43, 0xfffd, 0x44, 0x45, 0x46, 0x47, 0x48, 0xfffd,
    ]);
  });
});
