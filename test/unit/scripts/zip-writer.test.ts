// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createZip } from '../../../scripts/lib/zip-writer.mjs';

interface ReadEntry {
  name: string;
  method: number;
  flags: number;
  system: number;
  attr: number;
  crc: number;
  data: string;
}

// Python's zipfile is the independent reader: it honours flag bit 11 for names
// and checks every CRC in testzip().
const PYTHON_READER = `
import base64, json, sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
bad = z.testzip()
print(json.dumps({'bad': bad, 'entries': [{
  'name': i.filename, 'method': i.compress_type, 'flags': i.flag_bits,
  'system': i.create_system, 'attr': i.external_attr, 'crc': i.CRC,
  'data': base64.b64encode(z.read(i)).decode()} for i in z.infolist()]}))
`;

const STORE = 0;
const DEFLATE = 8;
const UTF8_NAME_FLAG = 0x800;
const LOCAL_CRC_OFFSET = 14;

let directory = '';

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'blok-zip-writer-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function save(archive: Buffer): string {
  const path = join(directory, 'archive.zip');

  writeFileSync(path, archive);

  return path;
}

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

  expect(result.status, result.stderr).toBe(0);

  return result.stdout;
}

function readWithPython(archive: Buffer): ReadEntry[] {
  const parsed: unknown = JSON.parse(run('python3', ['-I', '-c', PYTHON_READER, save(archive)]));

  if (typeof parsed !== 'object' || parsed === null || !('bad' in parsed) || !('entries' in parsed)) {
    throw new Error('python reader printed an unexpected shape');
  }

  expect(parsed.bad).toBeNull();

  return parsed.entries as ReadEntry[];
}

function bytesOf(entry: ReadEntry | undefined): Buffer {
  return Buffer.from(entry?.data ?? '', 'base64');
}

describe('createZip', () => {
  it('passes unzip -t and round-trips names and content', () => {
    const archive = createZip([
      { name: 'a.txt', data: 'hello' },
      { name: 'dir/b.bin', data: new Uint8Array([1, 2, 3]) },
    ]);

    expect(run('unzip', ['-t', save(archive)])).toContain('No errors detected');
    expect(run('unzip', ['-p', save(archive), 'a.txt'])).toBe('hello');

    const entries = readWithPython(archive);

    expect(entries.map((entry) => entry.name)).toEqual(['a.txt', 'dir/b.bin']);
    expect(bytesOf(entries[0]).toString('utf8')).toBe('hello');
    expect([...bytesOf(entries[1])]).toEqual([1, 2, 3]);
  });

  it('deflates by default and stores when asked', () => {
    const data = 'abc'.repeat(1000);

    expect(readWithPython(createZip([{ name: 'x', data }]))[0]?.method).toBe(DEFLATE);
    expect(readWithPython(createZip([{ name: 'x', data }], { compression: 'deflate' }))[0]?.method).toBe(DEFLATE);

    const stored = readWithPython(createZip([{ name: 'x', data }], { compression: 'store' }));

    expect(stored[0]?.method).toBe(STORE);
    expect(bytesOf(stored[0]).toString('utf8')).toBe(data);
    expect(run('zipinfo', [save(createZip([{ name: 'x', data }]))])).toMatch(/ defX /);
  });

  it('writes an empty file and an empty archive', () => {
    const entries = readWithPython(createZip([{ name: 'empty.txt', data: '' }]));

    expect(entries).toHaveLength(1);
    expect(bytesOf(entries[0])).toHaveLength(0);

    const empty = createZip([]);

    expect(empty).toHaveLength(22);
    expect(readWithPython(empty)).toEqual([]);
  });

  it('round-trips non-ASCII names and flags them UTF-8', () => {
    const names = ['документ.xml', 'emoji-🙂.txt', 'папка/файл.txt'];
    const entries = readWithPython(createZip(names.map((name) => ({ name, data: name }))));

    expect(entries.map((entry) => entry.name)).toEqual(names);
    expect(entries.map((entry) => bytesOf(entry).toString('utf8'))).toEqual(names);
    expect(entries.every((entry) => (entry.flags & UTF8_NAME_FLAG) !== 0)).toBe(true);
  });

  it('leaves the UTF-8 flag off for ASCII names', () => {
    expect((readWithPython(createZip([{ name: 'plain.txt', data: 'x' }]))[0]?.flags ?? -1) & UTF8_NAME_FLAG).toBe(0);
  });

  it('keeps every byte value in binary data, stored and deflated', () => {
    const all = Uint8Array.from({ length: 256 }, (_, index) => index);

    for (const compression of ['store', 'deflate'] as const) {
      expect([...bytesOf(readWithPython(createZip([{ name: 'b', data: all }], { compression }))[0])]).toEqual([...all]);
    }
  });

  it('round-trips a 5 MB file', () => {
    const big = Buffer.alloc(5 * 1024 * 1024);

    for (let index = 0; index < big.length; index += 1) {
      big[index] = (index * 31 + (index >> 10)) & 0xff;
    }

    const archive = createZip([{ name: 'big.bin', data: big }]);

    expect(run('unzip', ['-t', save(archive)])).toContain('No errors detected');
    expect(bytesOf(readWithPython(archive)[0]).equals(big)).toBe(true);
  });

  it('records unix mode bits when a mode is given', () => {
    const archive = createZip([{ name: 'blok-server', data: 'bin', mode: 0o100755 }]);
    const [entry] = readWithPython(archive);

    expect(entry?.system).toBe(3);
    expect(entry?.attr).toBe(0o100755 * 0x10000);
    expect(run('zipinfo', [save(archive)])).toMatch(/^-rwxr-xr-x .* unx .* blok-server$/m);
  });

  it('marks entries as DOS-made when no mode is given', () => {
    expect(readWithPython(createZip([{ name: 'a', data: 'a' }]))[0]?.system).toBe(0);
  });

  it('writes a directory entry only for a name ending in a slash', () => {
    const entries = readWithPython(createZip([{ name: 'dir/', data: '' }, { name: 'dir/a', data: 'a' }]));

    expect(entries.map((entry) => entry.name)).toEqual(['dir/', 'dir/a']);
  });

  it('produces the same bytes for the same input', () => {
    const files = [{ name: 'a', data: 'same' }, { name: 'b', data: new Uint8Array([9, 8, 7]), mode: 0o100644 }];

    expect(createZip(files).equals(createZip(files))).toBe(true);
    // 1980-01-01 00:00 in DOS time and date.
    expect(createZip(files).readUInt16LE(10)).toBe(0);
    expect(createZip(files).readUInt16LE(12)).toBe(33);
  });

  it.each([
    ['', 0x00000000],
    ['a', 0xe8b7be43],
    ['123456789', 0xcbf43926],
    ['The quick brown fox jumps over the lazy dog', 0x414fa339],
  ])('writes CRC-32 of %j as %i', (text, crc) => {
    const archive = createZip([{ name: 'v', data: text }], { compression: 'store' });

    expect(archive.readUInt32LE(LOCAL_CRC_OFFSET)).toBe(crc);
    expect(readWithPython(archive)[0]?.crc).toBe(crc);
  });

  it('refuses a file that would need zip64', () => {
    const huge = new Uint8Array(0);

    Object.defineProperty(huge, 'byteLength', { value: 2 ** 32 });

    expect(() => createZip([{ name: 'huge', data: huge }])).toThrow(/zip64/);
  });

  it('refuses more entries than a plain zip can count', () => {
    const files = Array.from({ length: 0xffff }, (_, index) => ({ name: `${index}`, data: '' }));

    expect(() => createZip(files)).toThrow(/zip64/);
    expect(() => createZip(files.slice(1), { compression: 'store' })).not.toThrow();
  });
});
