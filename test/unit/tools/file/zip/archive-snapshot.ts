import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import JSZipShim from '../../../../../src/tools/file/zip/jszip-shim';

/** What JSZip (or the shim) reads from one archive, in the shape of fixtures/golden/jszip-archives.json. */
export type ArchiveSnapshot =
  | { error: true }
  | {
    entries: Array<{ name: string; dir: boolean; size: number | null; sha256: string; text: string }>;
    fileNull: string[];
  };

export const ROOT = resolve(__dirname, '../../../../..');

export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export const textSha256 = (text: string): string => sha256(Buffer.from(text, 'utf16le'));

export const readGolden = (): Record<string, ArchiveSnapshot & { stage?: string }> =>
  JSON.parse(readFileSync(resolve(__dirname, 'fixtures/golden/jszip-archives.json'), 'utf8')) as Record<string, ArchiveSnapshot>;

/**
 * What the shim should match: the JSZip snapshot without its stage note (JSZip fails
 * some archives at read time that the reader refuses at load), and with the one
 * known gap applied: the reader ignores the WinRAR Unicode Path extra field (0x7075).
 */
export const expectedFor = (rel: string, snapshot: ArchiveSnapshot & { stage?: string }): ArchiveSnapshot => {
  if ('error' in snapshot) {
    return { error: true };
  }
  if (rel.endsWith('/winrar_utf8_in_name.zip')) {
    return { ...snapshot, entries: snapshot.entries.map((e) => ({ ...e, name: e.name.replace('€', '_') })) };
  }

  return snapshot;
};

/** Snapshots an archive through the shim. JSZip has no _data.uncompressedSize on empty files and dirs, so 0 maps to null. */
export async function snapshotShim(bytes: Uint8Array): Promise<ArchiveSnapshot> {
  try {
    const zip = await JSZipShim.loadAsync(bytes);
    const entries = [];

    for (const [name, file] of Object.entries(zip.files)) {
      const size = file._data.uncompressedSize;

      entries.push({
        name,
        dir: file.dir,
        size: size === 0 ? null : size,
        sha256: sha256(await file.async('uint8array')),
        text: textSha256(await file.async('string')),
      });
    }

    return { entries, fileNull: Object.keys(zip.files).filter((n) => zip.file(n) === null) };
  } catch {
    return { error: true };
  }
}
