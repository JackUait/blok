import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as InflateModule from '../../../../../../src/tools/file/zip/inflate';

vi.mock('../../../../../../src/tools/file/zip/inflate', async (importOriginal) => {
  const actual = await importOriginal<typeof InflateModule>();

  return { ...actual, inflateRaw: vi.fn(actual.inflateRaw) };
});

import { inflateRaw } from '../../../../../../src/tools/file/zip/inflate';
import { readZip } from '../../../../../../src/tools/file/zip/read-zip';
import { buildDeck } from '../helpers/buildDeck';
import { buildZip } from '../../zip/zip-builder';
import type { BuildEntry } from '../../zip/zip-builder';
import { parseZip, RECOMMENDED_ZIP_LIMITS } from '../../../../../../src/tools/file/pptx/parser/ZipParser';

const MB = 1024 * 1024;

/** A real deck plus the given extra entries, all deflated. */
const deckWith = async (extra: BuildEntry[]): Promise<ArrayBuffer> => {
  const archive = readZip(await buildDeck([{ text: 'Bomb' }]));
  const parts = archive.entries
    .filter((entry) => !entry.dir)
    .map((entry): BuildEntry => ({ name: entry.name, data: archive.read(entry), method: 8 }));

  vi.mocked(inflateRaw).mockClear();

  return buildZip([...parts, ...extra]).buffer;
};

/** An entry that declares `size` bytes but holds only a few; never inflated if refused up front. */
const declared = (name: string, size: number): BuildEntry => ({
  name,
  data: new Uint8Array(1),
  method: 8,
  size,
});

describe('parseZip against entries that lie about their size', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('refuses an entry that inflates past the size it declares, inflating only up to that size', async () => {
    const zip = await deckWith([{ name: 'ppt/media/image9.png', data: new Uint8Array(8 * MB), method: 8, size: 100 }]);

    await expect(parseZip(zip)).rejects.toThrow('output larger than declared size');
    // The inflater is handed the declared 100 bytes as its output size, never the real 8 MB.
    expect(vi.mocked(inflateRaw).mock.calls.map(([, size]) => size)).toContain(100);
    expect(vi.mocked(inflateRaw).mock.calls.every(([, size]) => size < MB)).toBe(true);
  });

  it('refuses an entry declared over the per-entry limit before inflating anything', async () => {
    const zip = await deckWith([declared('ppt/media/big.png', RECOMMENDED_ZIP_LIMITS.maxEntryUncompressedBytes + 1)]);

    await expect(parseZip(zip, RECOMMENDED_ZIP_LIMITS))
      .rejects.toThrow(/PPTX zip limit exceeded: ppt\/media\/big\.png is \d+ bytes > maxEntryUncompressedBytes/);
    expect(inflateRaw).not.toHaveBeenCalled();
  });

  it('refuses entries whose declared sizes pass the total limit before inflating anything', async () => {
    const zip = await deckWith(Array.from({ length: 9 }, (_, i) => declared(`ppt/embeddings/part${i}.bin`, 30 * MB)));

    await expect(parseZip(zip, RECOMMENDED_ZIP_LIMITS))
      .rejects.toThrow(/PPTX zip limit exceeded: total uncompressed bytes \d+ > maxTotalUncompressedBytes/);
    expect(inflateRaw).not.toHaveBeenCalled();
  });

  it('refuses media whose declared sizes pass the media limit before inflating anything', async () => {
    const zip = await deckWith(Array.from({ length: 7 }, (_, i) => declared(`ppt/media/image${i}.png`, 30 * MB)));

    await expect(parseZip(zip, RECOMMENDED_ZIP_LIMITS))
      .rejects.toThrow(/PPTX zip limit exceeded: media bytes \d+ > maxMediaBytes/);
    expect(inflateRaw).not.toHaveBeenCalled();
  });

  it('still reads an honest deck within the limits', async () => {
    const files = await parseZip(await deckWith([{ name: 'ppt/media/a.png', data: new Uint8Array(1024), method: 8 }]), {
      maxEntryUncompressedBytes: MB,
      maxTotalUncompressedBytes: MB,
      maxMediaBytes: MB,
    });

    expect(files.slides.size).toBe(1);
    expect(files.media.get('ppt/media/a.png')?.byteLength).toBe(1024);
  });
});
