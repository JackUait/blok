import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import JSZip from 'jszip';
import { buildDeck } from '../helpers/buildDeck';
import { parseZip } from '../../../../../../src/tools/file/pptx/parser/ZipParser';

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;

/** Rewrites the uncompressed size that the zip headers declare for `name`, as a hostile file would. */
const lieAboutSize = (zip: Uint8Array, name: string, declared: number): Uint8Array => {
  const out = zip.slice();
  const view = new DataView(out.buffer);
  const encodedName = new TextEncoder().encode(name);
  const nameAt = (offset: number): boolean => encodedName.every((byte, i) => out[offset + i] === byte);

  Array.from({ length: out.length - 46 }, (_, offset) => offset).forEach((offset) => {
    const signature = view.getUint32(offset, true);

    if (signature === LOCAL_HEADER && nameAt(offset + 30)) {
      view.setUint32(offset + 22, declared, true);
    }
    if (signature === CENTRAL_HEADER && nameAt(offset + 46)) {
      view.setUint32(offset + 24, declared, true);
    }
  });

  return out;
};

/** A real deck plus extra entries of zeros (they deflate to almost nothing). */
const deckWith = async (entries: Record<string, number>): Promise<Uint8Array> => {
  const zip = await JSZip.loadAsync(await buildDeck([{ text: 'Bomb' }]));

  Object.entries(entries).forEach(([name, size]) => zip.file(name, new Uint8Array(size)));

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
};

const MB = 1024 * 1024;

describe('parseZip against entries that lie about their size', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('stops inflating an entry once it passes the per-entry cap', async () => {
    const zip = lieAboutSize(await deckWith({ 'ppt/media/image9.png': 8 * MB }), 'ppt/media/image9.png', 100);

    await expect(parseZip(zip.buffer, { maxEntryUncompressedBytes: MB }))
      .rejects.toThrow(/PPTX zip limit exceeded: ppt\/media\/image9\.png/);
  });

  it('counts the real inflated bytes against the total cap', async () => {
    const entries = { 'ppt/media/a.png': 600 * 1024, 'ppt/media/b.png': 600 * 1024, 'ppt/media/c.png': 600 * 1024 };
    const zip = Object.keys(entries).reduce(
      (bytes, name) => lieAboutSize(bytes, name, 100),
      await deckWith(entries)
    );

    await expect(parseZip(zip.buffer, { maxTotalUncompressedBytes: MB }))
      .rejects.toThrow(/PPTX zip limit exceeded: total uncompressed bytes/);
  });

  it('counts the real inflated bytes against the media cap', async () => {
    const entries = { 'ppt/media/a.png': 600 * 1024, 'ppt/media/b.png': 600 * 1024 };
    const zip = Object.keys(entries).reduce(
      (bytes, name) => lieAboutSize(bytes, name, 100),
      await deckWith(entries)
    );

    await expect(parseZip(zip.buffer, { maxMediaBytes: MB }))
      .rejects.toThrow(/PPTX zip limit exceeded: media bytes/);
  });

  it('still reads an honest deck within the limits', async () => {
    const files = await parseZip((await deckWith({ 'ppt/media/a.png': 1024 })).buffer, {
      maxEntryUncompressedBytes: MB,
      maxTotalUncompressedBytes: MB,
      maxMediaBytes: MB,
    });

    expect(files.slides.size).toBe(1);
    expect(files.media.get('ppt/media/a.png')?.byteLength).toBe(1024);
  });
});
