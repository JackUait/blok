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

  it('returns the three output types docx-preview and pptx-renderer ask for', async () => {
    const zip = await JSZipShim.loadAsync(fixture('jszip/all.zip'));
    const file = fileOf(zip, 'Hello.txt');
    const uint8array = await file.async('uint8array');
    const blob = await file.async('blob');

    await expect(file.async('string')).resolves.toBe('Hello World\n');
    expect(uint8array).toBeInstanceOf(Uint8Array);
    expect(uint8array.buffer.byteLength).toBe(12);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('');
    await expect(blob.text()).resolves.toBe('Hello World\n');
  });

  it('inflates an entry once however often it is read', async () => {
    const zip = await JSZipShim.loadAsync(buildZip([{ name: 'img.bin', data: new Uint8Array(4096).fill(9), method: 8 }]));
    const file = fileOf(zip, 'img.bin');

    for (let i = 0; i < 5; i++) {
      await file.async('blob');
      await file.async('uint8array');
      await file.async('string');
    }
    expect(inflateRaw).toHaveBeenCalledTimes(1);
  });

  it('hands out one Blob per entry, since a Blob cannot be changed', async () => {
    const zip = await JSZipShim.loadAsync(buildZip([{ name: 'img.bin', data: new Uint8Array(64).fill(1), method: 8 }]));
    const file = fileOf(zip, 'img.bin');

    expect(await file.async('blob')).toBe(await file.async('blob'));
  });

  it('never hands out its cached bytes: a caller changing them in place changes nothing later', async () => {
    // docx-preview deobfuscates fonts in place on the uint8array it gets.
    const zip = await JSZipShim.loadAsync(buildZip([{ name: 'font.odttf', data: utf8('font bytes'), method: 8 }]));
    const file = fileOf(zip, 'font.odttf');

    (await file.async('uint8array')).fill(0);
    expect(new TextDecoder().decode(await file.async('uint8array'))).toBe('font bytes');
    await expect(file.async('string')).resolves.toBe('font bytes');
    await expect((await file.async('blob')).text()).resolves.toBe('font bytes');
  });

  it('gives a fresh copy on every read', async () => {
    const zip = await JSZipShim.loadAsync(fixture('jszip/deflate.zip'));
    const file = fileOf(zip, 'Hello.txt');
    const first = await file.async('uint8array');

    first.fill(0);
    await expect(file.async('string')).resolves.toContain('looong');
  });

  it.each(['text', 'arraybuffer', 'base64', 'STRING'])('rejects output type %s, which no consumer asks for', async (type) => {
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
