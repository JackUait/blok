import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, it, expect } from 'vitest';

import type { ArchiveSnapshot } from './archive-snapshot';
import { ROOT, readGolden, sha256, snapshotShim, textSha256, expectedFor, isUtf8 } from './archive-snapshot';

// Live check against the real jszip while it is still installed. Delete this file
// when jszip leaves; jszip-parity.test.ts keeps the same checks on golden data.

interface RefFile {
  dir: boolean;
  _data?: { uncompressedSize?: unknown };
  async(type: 'uint8array'): Promise<Uint8Array>;
  async(type: 'string'): Promise<string>;
}
interface RefZip { files: Record<string, RefFile>; file(name: string): RefFile | null }
interface RefJSZip { support: { nodebuffer: boolean }; loadAsync(data: Uint8Array): Promise<RefZip> }

const isRefJSZip = (value: unknown): value is RefJSZip =>
  typeof value === 'function' && 'loadAsync' in value && typeof value.loadAsync === 'function';

/**
 * The browser build Blok ships. Vitest would load the Node build, which decodes
 * invalid UTF-8 through Buffer and so differs from what users run.
 */
function browserJSZip(): RefJSZip {
  const path = createRequire(resolve(ROOT, 'package.json')).resolve('jszip/dist/jszip.min.js');
  const sandbox = { module: { exports: {} }, exports: {}, setTimeout, clearTimeout, setImmediate };

  sandbox.exports = sandbox.module.exports;
  runInNewContext(readFileSync(path, 'utf8'), sandbox);
  const loaded: unknown = sandbox.module.exports;

  if (!isRefJSZip(loaded)) {
    throw new Error('jszip did not load');
  }

  return loaded;
}

async function snapshotJSZip(jszip: RefJSZip, bytes: Uint8Array): Promise<ArchiveSnapshot> {
  try {
    const zip = await jszip.loadAsync(bytes);
    const entries = [];

    for (const [name, file] of Object.entries(zip.files)) {
      const size = file._data?.uncompressedSize;
      const bytes = await file.async('uint8array');

      entries.push({
        name,
        dir: file.dir,
        size: typeof size === 'number' ? size : null,
        sha256: sha256(Uint8Array.from(bytes)),
        text: isUtf8(bytes) ? textSha256(await file.async('string')) : 'not-utf8',
      });
    }

    return { entries, fileNull: Object.keys(zip.files).filter((n) => zip.file(n) === null) };
  } catch {
    return { error: true };
  }
}

describe('JSZip differential (live jszip)', () => {
  const jszip = browserJSZip();
  const golden = readGolden();

  it('runs the browser build', () => {
    expect(jszip.support.nodebuffer).toBe(false);
  });

  it.each(Object.keys(golden))('%s: shim, live JSZip and golden agree', async (rel) => {
    const bytes = new Uint8Array(readFileSync(resolve(ROOT, rel)));
    const live = await snapshotJSZip(jszip, bytes);

    const committed = golden[rel] ?? { error: true };

    expect('error' in committed ? { error: true } : committed).toEqual(live);
    expect(await snapshotShim(bytes)).toEqual(expectedFor(rel, live));
  });
});
