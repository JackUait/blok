import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import { readZip } from '../../../../../src/tools/file/zip/read-zip';
import { ZipError } from '../../../../../src/tools/file/zip/zip-error';
import { ROOT, readGolden, sha256, snapshotShim, expectedFor } from './archive-snapshot';

// Golden data captured from the browser build of jszip 3.10.2 (no Buffer global),
// the build Blok's bundle shipped. It stays valid after jszip leaves the tree.
const golden = readGolden();
const archives = Object.keys(golden);
const bytesOf = (rel: string): Uint8Array => new Uint8Array(readFileSync(resolve(ROOT, rel)));

describe('JSZip parity against golden data', () => {
  it('covers the upstream refs, the Office samples and the text fixture', () => {
    expect(archives.length).toBeGreaterThan(55);
  });

  it.each(archives)('shim reads %s like JSZip did', async (rel) => {
    expect(await snapshotShim(bytesOf(rel))).toEqual(expectedFor(rel, golden[rel] ?? { error: true }));
  });

  it.each(archives)('readZip reads %s like JSZip did', (rel) => {
    const expected = expectedFor(rel, golden[rel] ?? { error: true });
    const read = (): Array<{ name: string; dir: boolean; sha256: string }> => {
      const archive = readZip(bytesOf(rel));

      return archive.entries.map((e) => ({ name: e.name, dir: e.dir, sha256: sha256(archive.read(e)) }));
    };

    if ('error' in expected) {
      expect(read).toThrow(ZipError);

      return;
    }
    const byName = (a: { name: string }, b: { name: string }): number => (a.name < b.name ? -1 : 1);

    expect(read().sort(byName)).toEqual(
      expected.entries.map((e) => ({ name: e.name, dir: e.dir, sha256: e.sha256 })).sort(byName)
    );
  });
});
