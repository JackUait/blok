import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatDuration,
  headLines,
  cardSrc,
  HEAD_BYTES,
  initialContent,
  inkBox,
  loadCardContent,
  MAX_WHOLE_BYTES,
  readHead,
  zipEntryCount,
  type CardSource,
} from '../../../../../src/tools/file/card/card-content';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A response whose body arrives in chunks, and that records a cancel. */
function streamed(chunks: Uint8Array[], init: ResponseInit = {}): { response: Response; cancelled: () => boolean; pulled: () => number } {
  const state = { cancelled: false, pulled: 0 };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[state.pulled];
      if (chunk === undefined) {
        controller.close();

        return;
      }
      state.pulled += 1;
      controller.enqueue(chunk);
    },
    cancel() {
      state.cancelled = true;
    },
  }, { highWaterMark: 0 });

  return { response: new Response(body, init), cancelled: () => state.cancelled, pulled: () => state.pulled };
}

const source = (data: CardSource['data'], signal = new AbortController().signal): CardSource => ({ data, config: {}, signal });

describe('card content', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('readHead', () => {
    it('stops the download once it has the bytes it needs', async () => {
      const chunk = new Uint8Array(1024).fill(65);
      const { response, cancelled, pulled } = streamed(Array.from({ length: 100 }, () => chunk));
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

      const head = await readHead('https://cdn/big.ts', 2048, new AbortController().signal);

      expect(cancelled()).toBe(true);
      expect(pulled()).toBeLessThan(5);
      expect(head?.bytes).toHaveLength(2048);
      expect(head?.complete).toBe(false);
    });

    it('sends no referrer, so a file host never learns the page address', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(streamed([encode('a')]).response);
      vi.stubGlobal('fetch', fetchSpy);

      await readHead('https://cdn/a.ts', 10, new AbortController().signal);

      expect(fetchSpy.mock.calls[0][1].referrerPolicy).toBe('no-referrer');
    });

    it('says a small file was read whole', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamed([encode('a\nb\n')]).response));

      const head = await readHead('https://cdn/small.ts', HEAD_BYTES, new AbortController().signal);

      expect(head?.complete).toBe(true);
    });

    it('reads nothing from a url that is not http(s) or blob', async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      expect(await readHead('javascript:alert(1)', 10, new AbortController().signal)).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('gives null for an error status or a failed request', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 403 })));
      expect(await readHead('https://cdn/x.ts', 10, new AbortController().signal)).toBeNull();

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('CORS')));
      expect(await readHead('https://cdn/x.ts', 10, new AbortController().signal)).toBeNull();
    });
  });

  describe('cardSrc', () => {
    it('reads a relative url against the page', () => {
      expect(cardSrc('/samples/a.txt')).toBe(`${window.location.origin}/samples/a.txt`);
    });

    it('keeps http(s) and blob urls, and refuses the rest', () => {
      expect(cardSrc('https://cdn/a.txt')).toBe('https://cdn/a.txt');
      expect(cardSrc('blob:https://app/1-2')).toBe('blob:https://app/1-2');
      expect(cardSrc('data:text/html,<b>x</b>')).toBeNull();
      expect(cardSrc('javascript:alert(1)')).toBeNull();
    });
  });

  describe('headLines', () => {
    it('drops a last line that was cut off mid-way', () => {
      const { lines, total } = headLines({ bytes: encode('one\ntwo\nthr'), complete: false }, 10);

      expect(lines).toEqual(['one', 'two']);
      expect(total).toBeNull();
    });

    it('counts the lines of a file it read whole; a final line break starts no line', () => {
      const { lines, total } = headLines({ bytes: encode('one\r\ntwo\r\n'), complete: true }, 10);

      expect(lines).toEqual(['one', 'two']);
      expect(total).toBe(2);
    });

    it('cuts a long line to what a sheet can show, unless told to keep it whole', () => {
      const head = { bytes: encode(`${'x'.repeat(300)}\nnext`), complete: true };

      expect(headLines(head, 10).lines[0]).toHaveLength(120);
      // Markdown asks for whole lines: a cut inside an HTML tag would swallow the text after it.
      expect(headLines(head, 10, Infinity).lines[0]).toHaveLength(300);
    });

    it('keeps at most the lines asked for, and drops a byte order mark', () => {
      const { lines, total } = headLines({ bytes: encode('﻿a\nb\nc\nd'), complete: true }, 2);

      expect(lines).toEqual(['a', 'b']);
      expect(total).toBe(4);
    });
  });

  it('formats a duration as m:ss, and h:mm:ss past an hour', () => {
    expect(formatDuration(68.2)).toBe('1:08');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  describe('inkBox', () => {
    const page = (width: number, height: number, ink: Array<[number, number]>): Uint8ClampedArray => {
      const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
      ink.forEach(([x, y]) => pixels.set([20, 20, 20, 255], (y * width + x) * 4));

      return pixels;
    };

    it('finds where the ink starts and ends, as fractions of the page', () => {
      expect(inkBox(page(10, 20, [[2, 4], [7, 9]]), 10, 20)).toEqual({ left: 0.2, top: 0.2, right: 0.8 });
    });

    it('treats a blank page as all content', () => {
      expect(inkBox(page(10, 10, []), 10, 10)).toEqual({ left: 0, top: 0, right: 1 });
    });

    it('does not count light paper tints or clear pixels as ink', () => {
      const pixels = page(4, 4, []);
      pixels.set([240, 240, 236, 255], 0);
      pixels.set([0, 0, 0, 0], 4);

      expect(inkBox(pixels, 4, 4)).toEqual({ left: 0, top: 0, right: 1 });
    });
  });

  describe('zipEntryCount', () => {
    const endRecord = (count: number, comment = 0): Uint8Array => {
      const bytes = new Uint8Array(22 + comment);
      const view = new DataView(bytes.buffer);
      view.setUint32(0, 0x06054b50, true);
      view.setUint16(8, count, true);
      view.setUint16(10, count, true);
      view.setUint16(20, comment, true);

      return bytes;
    };

    it('reads the number of entries from the end record', () => {
      expect(zipEntryCount(endRecord(38))).toBe(38);
    });

    it('finds the end record before a trailing comment and after other bytes', () => {
      const tail = new Uint8Array(100 + 27);
      tail.set(endRecord(7, 5), 100);

      expect(zipEntryCount(tail)).toBe(7);
    });

    it('gives null for bytes that hold no end record, and for a zip64 count', () => {
      expect(zipEntryCount(new Uint8Array(64))).toBeNull();
      expect(zipEntryCount(endRecord(0xffff))).toBeNull();
    });
  });

  describe('initialContent', () => {
    it('gives a record, a folder or a punch card at once, titled by the file', () => {
      expect(initialContent('audio', 'take-2.mp3')).toEqual({ kind: 'audio', title: 'Take 2' });
      expect(initialContent('archive', 'assets.zip')).toEqual({ kind: 'archive', title: 'Assets' });
      expect(initialContent('generic', 'backup.bin')).toEqual({ kind: 'generic', title: 'Backup', bytes: null });
    });

    it('gives nothing for files whose object is their content', () => {
      expect(initialContent('code', 'a.ts')).toBeNull();
      expect(initialContent('pdf', 'a.pdf')).toBeNull();
    });
  });

  describe('loadCardContent', () => {
    it('reads the first lines of a code file and counts them when the file is small', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamed([encode('const a = 1;\nconst b = 2;\n')]).response));

      const loaded = await loadCardContent('code', source({ url: 'https://cdn/a.zig', fileName: 'a.zig' }));

      expect(loaded?.content).toEqual({ kind: 'code', fileName: 'a.zig', lang: 'plain', text: 'const a = 1;\nconst b = 2;', html: null });
      expect(loaded?.count).toEqual({ unit: 'lines', value: 2 });
    });

    it('shows at most fourteen lines of code and gives no count for a file it did not finish', async () => {
      const long = Array.from({ length: 400 }, (_, i) => `line ${i} of the file, padded so it is long enough`).join('\n');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamed([encode(long)]).response));

      const loaded = await loadCardContent('code', source({ url: 'https://cdn/a.zig', fileName: 'a.zig' }));

      expect(loaded?.content.kind === 'code' && loaded.content.text.split('\n')).toHaveLength(14);
      expect(loaded?.count).toBeUndefined();
    });

    it('gives null for a file it cannot read, so the card stays plain', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('CORS')));

      expect(await loadCardContent('code', source({ url: 'https://cdn/a.ts', fileName: 'a.ts' }))).toBeNull();
      expect(await loadCardContent('text', source({ url: 'https://cdn/a.txt', fileName: 'a.txt' }))).toBeNull();
    });

    it('gives null for an empty text file', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamed([encode('  \n')]).response));

      expect(await loadCardContent('text', source({ url: 'https://cdn/a.txt', fileName: 'a.txt' }))).toBeNull();
    });

    it('reads plain text as lines', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamed([encode('Release notes\n\nFixed a bug.')]).response));

      const loaded = await loadCardContent('text', source({ url: 'https://cdn/notes.txt', fileName: 'notes.txt' }));

      expect(loaded?.content).toEqual({ kind: 'text', text: 'Release notes\n\nFixed a bug.' });
      expect(loaded?.count).toEqual({ unit: 'lines', value: 3 });
    });

    it('renders Markdown', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamed([encode('# README\n\nHello.')]).response));

      const loaded = await loadCardContent('text', source({ url: 'https://cdn/README.md', fileName: 'README.md' }));

      expect(loaded?.content.kind).toBe('markdown');
      expect(loaded?.content.kind === 'markdown' && loaded.content.html).toContain('README</h1>');
    });

    it('reads far enough into a Markdown file to get past a long block of badges', async () => {
      const badges = Array.from({ length: 40 }, (_, i) => `<a href="https://x/${i}"><img alt="badge ${i}" src="https://img/${i}.svg?style=flat-square&label=package"></a>`).join('\n');
      const md = `# Blok\n\n<p align="center">\n${badges}\n</p>\n\nA block editor for the web.\n`;
      expect(md.length).toBeGreaterThan(4096);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamed([encode(md)]).response));

      const loaded = await loadCardContent('text', source({ url: 'https://cdn/README.md', fileName: 'README.md' }));

      expect(loaded?.content.kind === 'markdown' && loaded.content.html).toContain('A block editor for the web.');
    });

    it('reads the real cells of a CSV, with numbers marked', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamed([encode('Name,Total\nAda,12.5\nGrace,7\n')]).response));

      const loaded = await loadCardContent('spreadsheet', source({ url: 'https://cdn/people.csv', fileName: 'people.csv' }));

      expect(loaded?.content).toEqual({
        kind: 'spreadsheet',
        rows: [
          [{ text: 'Name', value: null }, { text: 'Total', value: null }],
          [{ text: 'Ada', value: null }, { text: '12.5', value: 12.5 }],
          [{ text: 'Grace', value: null }, { text: '7', value: 7 }],
        ],
      });
    });

    it('does not download an office file larger than the limit', async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const loaded = await loadCardContent('spreadsheet', source({ url: 'https://cdn/big.xlsx', fileName: 'big.xlsx', size: MAX_WHOLE_BYTES + 1 }));

      expect(loaded).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('stops an office download whose declared length is over the limit', async () => {
      const { response, cancelled } = streamed([new Uint8Array(10)], { headers: { 'content-length': String(MAX_WHOLE_BYTES + 1) } });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

      expect(await loadCardContent('document', source({ url: 'https://cdn/big.docx', fileName: 'big.docx' }))).toBeNull();
      expect(cancelled()).toBe(true);
    });

    it('has no reader for old office formats, and downloads nothing for them', async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      expect(await loadCardContent('document', source({ url: 'https://cdn/a.rtf', fileName: 'a.rtf' }))).toBeNull();
      expect(await loadCardContent('presentation', source({ url: 'https://cdn/a.key', fileName: 'a.key' }))).toBeNull();
      expect(await loadCardContent('spreadsheet', source({ url: 'https://cdn/a.numbers', fileName: 'a.numbers' }))).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('counts the files of a zip from its last bytes only', async () => {
      const tail = new Uint8Array(22);
      const view = new DataView(tail.buffer);
      view.setUint32(0, 0x06054b50, true);
      view.setUint16(10, 38, true);
      const fetchSpy = vi.fn().mockResolvedValue(new Response(tail, { status: 206 }));
      vi.stubGlobal('fetch', fetchSpy);

      const loaded = await loadCardContent('archive', source({ url: 'https://cdn/brand-assets.zip', fileName: 'brand-assets.zip' }));

      expect(fetchSpy.mock.calls[0][1].headers).toEqual({ Range: 'bytes=-65557' });
      expect(fetchSpy.mock.calls[0][1].referrerPolicy).toBe('no-referrer');
      expect(loaded?.content).toEqual({ kind: 'archive', title: 'Brand assets' });
      expect(loaded?.count).toEqual({ unit: 'files', value: 38 });
    });

    it('gives a zip no count when the server sends the whole file instead of its end', async () => {
      const { response, cancelled } = streamed([new Uint8Array(10)], { status: 200 });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

      const loaded = await loadCardContent('archive', source({ url: 'https://cdn/a.zip', fileName: 'a.zip' }));

      expect(loaded?.count).toBeUndefined();
      expect(cancelled()).toBe(true);
    });

    it('reads the first bytes of an unknown file for its punch card', async () => {
      const bytes = Uint8Array.from({ length: 64 }, (_, i) => i);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamed([bytes]).response));

      const loaded = await loadCardContent('generic', source({ url: 'https://cdn/backup.bin', fileName: 'backup.bin' }));

      expect(loaded?.content).toEqual({ kind: 'generic', title: 'Backup', bytes });
    });

    it('reads nothing once the card is gone', async () => {
      const controller = new AbortController();
      controller.abort();
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      expect(await loadCardContent('code', source({ url: 'https://cdn/a.ts', fileName: 'a.ts' }, controller.signal))).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('reads two files at a time; the third waits for a free turn', async () => {
      const gates: Array<(response: Response) => void> = [];
      const fetchSpy = vi.fn(() => new Promise<Response>((resolve) => {
        gates.push(resolve);
      }));
      vi.stubGlobal('fetch', fetchSpy);
      const load = (name: string): Promise<unknown> => loadCardContent('text', source({ url: `https://cdn/${name}.txt`, fileName: `${name}.txt` }));

      const all = [load('a'), load('b'), load('c')];
      await Promise.resolve();
      await Promise.resolve();
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      gates[0](streamed([encode('a')]).response);
      await all[0];
      await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));

      gates[1](streamed([encode('b')]).response);
      gates[2](streamed([encode('c')]).response);
      await Promise.all(all);
    });
  });
});
