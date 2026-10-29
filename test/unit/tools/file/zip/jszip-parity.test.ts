import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import { readZip } from '../../../../../src/tools/file/zip/read-zip';
import { ZipError } from '../../../../../src/tools/file/zip/zip-error';
import { ROOT, readGolden, sha256, expectedFor, isUtf8, textSha256 } from './archive-snapshot';

// Golden data captured from the browser build of jszip 3.10.2 (no Buffer global),
// the build Blok's bundle shipped. It stays valid after jszip leaves the tree.
const golden = readGolden();
const bytesOf = (rel: string): Uint8Array => new Uint8Array(readFileSync(resolve(ROOT, rel)));

describe('JSZip parity against golden data', () => {
  it('covers the upstream refs, the Office samples and the text fixture', () => {
    expect(Object.keys(golden).length).toBeGreaterThan(55);
  });

  it.each(Object.entries(golden))('readZip reads %s like JSZip did', async (rel, snapshot) => {
    const expected = expectedFor(rel, snapshot);
    // Text decodes the way the Office readers decode it. JSZip has no size on empty files and dirs, so 0 maps to null.
    const utf8 = new TextDecoder('utf-8', { ignoreBOM: true });
    const read = async (): Promise<Array<{ name: string; dir: boolean; size: number | null; sha256: string; text: string }>> => {
      const archive = readZip(bytesOf(rel));

      return Promise.all(archive.entries.map(async (e) => {
        const bytes = await archive.read(e);

        return {
          name: e.name,
          dir: e.dir,
          size: e.size === 0 ? null : e.size,
          sha256: sha256(bytes),
          text: isUtf8(bytes) ? textSha256(utf8.decode(bytes)) : 'not-utf8',
        };
      }));
    };

    if ('error' in expected) {
      await expect(read()).rejects.toThrow(ZipError);

      return;
    }
    const byName = (a: { name: string }, b: { name: string }): number => (a.name < b.name ? -1 : 1);

    expect((await read()).sort(byName)).toEqual([...expected.entries].sort(byName));
  });
});
