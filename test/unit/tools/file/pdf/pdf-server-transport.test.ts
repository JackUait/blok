import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SERVER_CHUNK_BYTES,
  createRangeTransport,
  createServerRangeSource,
  type RangeReader,
} from '../../../../../src/tools/file/pdf/pdf-server-transport';
import { PdfUnreadableError } from '../../../../../src/tools/file/pdf/pdf-errors';

const ENDPOINT = 'https://blok.example.com/file-bytes';
const FILE = 'https://files.example.com/a.pdf';
const MIB = 1_048_576;

/** A PDF of `size` bytes whose byte at offset i is i % 251, after the %PDF- header. */
function pdfBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    bytes[i] = i % 251;
  }
  bytes.set(new TextEncoder().encode('%PDF-'), 0);

  return bytes;
}

interface Asked {
  url: string;
  headers: Record<string, string>;
}

/**
 * Answers like /file-bytes does in fixtures/file-bytes-responses.json:
 * one `bytes=a-b` range forwarded as 206 with Content-Range, the whole file
 * as 200, any answer over 1 MiB as 413 "range too large".
 */
function fakeServer(file: Uint8Array, options: { total?: string; status?: number } = {}): { fetch: typeof fetch; asked: Asked[] } {
  const asked: Asked[] = [];
  const fakeFetch = vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    asked.push({ url: input, headers });
    if (options.status !== undefined) {
      return new Response('nope\n', { status: options.status });
    }
    const match = /^bytes=(\d+)-(\d+)$/.exec(headers.range ?? '');
    if (match === null) {
      return file.length > MIB
        ? new Response('range too large\n', { status: 413 })
        : new Response(file.slice(), { status: 200 });
    }
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), file.length - 1);
    if (end - start + 1 > MIB) {
      return new Response('range too large\n', { status: 413 });
    }

    return new Response(file.slice(start, end + 1), {
      status: 206,
      headers: { 'Content-Range': `bytes ${start}-${end}/${options.total ?? file.length}` },
    });
  });

  return { fetch: fakeFetch as unknown as typeof fetch, asked };
}

describe('createServerRangeSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('asks for the first MiB of the file through the route', async () => {
    const server = fakeServer(pdfBytes(3 * MIB));
    vi.stubGlobal('fetch', server.fetch);

    await createServerRangeSource(ENDPOINT, FILE, undefined, new AbortController().signal);

    expect(server.asked[0]).toMatchObject({
      url: `${ENDPOINT}?url=${encodeURIComponent(FILE)}`,
      headers: { range: `bytes=0-${MIB - 1}` },
    });
    expect(SERVER_CHUNK_BYTES).toBe(MIB);
  });

  it('hands a small file over as bytes, in one request', async () => {
    const file = pdfBytes(1500);
    const server = fakeServer(file);
    vi.stubGlobal('fetch', server.fetch);

    const source = await createServerRangeSource(ENDPOINT, FILE, undefined, new AbortController().signal);

    expect(source?.kind).toBe('data');
    expect(source?.kind === 'data' && Array.from(source.data)).toEqual(Array.from(file));
    expect(server.asked).toHaveLength(1);
  });

  it('takes a whole-file 200 as bytes', async () => {
    const file = pdfBytes(1500);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(file.slice(), { status: 200 })));

    const source = await createServerRangeSource(ENDPOINT, FILE, undefined, new AbortController().signal);

    expect(source?.kind === 'data' && source.data.length).toBe(1500);
  });

  it('reads a large file in ranges of at most 1 MiB, which together are the file', async () => {
    const file = pdfBytes(3 * MIB + 100);
    const server = fakeServer(file);
    vi.stubGlobal('fetch', server.fetch);

    const source = await createServerRangeSource(ENDPOINT, FILE, undefined, new AbortController().signal);
    if (source?.kind !== 'transport') {
      throw new Error(`expected a transport, got ${source?.kind}`);
    }
    // pdf.js groups neighbouring chunks into one request; `end` is exclusive.
    const rest = await source.reader.read(MIB, file.length);

    expect(source.reader.length).toBe(file.length);
    expect(Array.from(source.reader.initial)).toEqual(Array.from(file.subarray(0, MIB)));
    expect(server.asked.slice(1).map(({ headers }) => headers.range)).toEqual([
      `bytes=${MIB}-${2 * MIB - 1}`,
      `bytes=${2 * MIB}-${3 * MIB - 1}`,
      `bytes=${3 * MIB}-${3 * MIB + 99}`,
    ]);
    expect(rest.length).toBe(2 * MIB + 100);
    expect(rest[0]).toBe(file[MIB]);
    expect(rest[rest.length - 1]).toBe(file[file.length - 1]);
  });

  it('mints the headers again for every request', async () => {
    const server = fakeServer(pdfBytes(2 * MIB));
    vi.stubGlobal('fetch', server.fetch);
    const minted = { count: 0 };
    const headers = vi.fn(async () => {
      minted.count += 1;

      return { Authorization: `Bearer pass-${minted.count}` };
    });

    const source = await createServerRangeSource(ENDPOINT, FILE, headers, new AbortController().signal);
    if (source?.kind !== 'transport') {
      throw new Error('expected a transport');
    }
    await source.reader.read(MIB, 2 * MIB);

    expect(server.asked.map(({ headers: sent }) => sent.authorization)).toEqual(['Bearer pass-1', 'Bearer pass-2']);
  });

  it('sends static headers as they are', async () => {
    const server = fakeServer(pdfBytes(1500));
    vi.stubGlobal('fetch', server.fetch);

    await createServerRangeSource(ENDPOINT, FILE, { Authorization: 'Bearer fixed' }, new AbortController().signal);

    expect(server.asked[0]?.headers.authorization).toBe('Bearer fixed');
  });

  it('gives up quietly when the route is off (404)', async () => {
    vi.stubGlobal('fetch', fakeServer(pdfBytes(10), { status: 404 }).fetch);

    await expect(createServerRangeSource(ENDPOINT, FILE, undefined, new AbortController().signal)).resolves.toBeNull();
  });

  it.each([401, 403, 413, 429, 502])('gives up quietly on %i', async (status) => {
    vi.stubGlobal('fetch', fakeServer(pdfBytes(10), { status }).fetch);

    await expect(createServerRangeSource(ENDPOINT, FILE, undefined, new AbortController().signal)).resolves.toBeNull();
  });

  it('says the file is no PDF on 415', async () => {
    vi.stubGlobal('fetch', fakeServer(pdfBytes(10), { status: 415 }).fetch);

    await expect(createServerRangeSource(ENDPOINT, FILE, undefined, new AbortController().signal))
      .rejects.toBeInstanceOf(PdfUnreadableError);
  });

  it('gives up quietly when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));

    await expect(createServerRangeSource(ENDPOINT, FILE, undefined, new AbortController().signal)).resolves.toBeNull();
  });

  it('gives up quietly when the headers cannot be minted', async () => {
    vi.stubGlobal('fetch', fakeServer(pdfBytes(10)).fetch);

    await expect(createServerRangeSource(ENDPOINT, FILE, () => Promise.reject(new Error('no pass')), new AbortController().signal))
      .resolves.toBeNull();
  });

  it('gives up quietly when the total size is unknown', async () => {
    vi.stubGlobal('fetch', fakeServer(pdfBytes(2 * MIB), { total: '*' }).fetch);

    await expect(createServerRangeSource(ENDPOINT, FILE, undefined, new AbortController().signal)).resolves.toBeNull();
  });

  it('fails a range whose answer sits somewhere else in the file', async () => {
    const file = pdfBytes(2 * MIB);
    const server = fakeServer(file);
    vi.stubGlobal('fetch', server.fetch);
    const source = await createServerRangeSource(ENDPOINT, FILE, undefined, new AbortController().signal);
    if (source?.kind !== 'transport') {
      throw new Error('expected a transport');
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(file.slice(0, 10), {
      status: 206,
      headers: { 'Content-Range': `bytes 0-9/${file.length}` },
    })));

    await expect(source.reader.read(MIB, 2 * MIB)).rejects.toThrow();
  });

  it('passes the preview\'s signal to every request', async () => {
    const server = fakeServer(pdfBytes(1500));
    vi.stubGlobal('fetch', server.fetch);
    const controller = new AbortController();

    await createServerRangeSource(ENDPOINT, FILE, undefined, controller.signal);

    expect(vi.mocked(server.fetch).mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});

describe('createRangeTransport', () => {
  /** The shape of pdf.js's PDFDataRangeTransport the subclass relies on. */
  class FakeBase {
    readonly delivered: Array<{ begin: number; chunk: Uint8Array }> = [];

    constructor(public length: number, public initialData: Uint8Array) {}

    onDataRange(begin: number, chunk: Uint8Array): void {
      this.delivered.push({ begin, chunk });
    }

    requestDataRange(_begin: number, _end: number): void {
      throw new Error('abstract');
    }

    abort(): void {}
  }
  const lib = { PDFDataRangeTransport: FakeBase } as unknown as Parameters<typeof createRangeTransport>[0];

  const reader = (read: RangeReader['read']): RangeReader => ({ length: 5 * MIB, initial: new Uint8Array(MIB), read });
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it('starts from the first answer and delivers each asked range once, whole', async () => {
    const read = vi.fn(async (begin: number, end: number) => new Uint8Array(end - begin));
    const transport = createRangeTransport(lib, reader(read), vi.fn()) as unknown as FakeBase;

    transport.requestDataRange(MIB, 3 * MIB);
    await settle();

    expect(transport).toBeInstanceOf(FakeBase);
    expect(transport.length).toBe(5 * MIB);
    expect(transport.initialData.length).toBe(MIB);
    expect(read).toHaveBeenCalledWith(MIB, 3 * MIB);
    expect(transport.delivered).toHaveLength(1);
    expect(transport.delivered[0]?.begin).toBe(MIB);
    expect(transport.delivered[0]?.chunk.length).toBe(2 * MIB);
  });

  it('reports a range that cannot be read', async () => {
    const onFailure = vi.fn();
    const transport = createRangeTransport(lib, reader(() => Promise.reject(new Error('429'))), onFailure) as unknown as FakeBase;

    transport.requestDataRange(MIB, 2 * MIB);
    await settle();

    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(transport.delivered).toEqual([]);
  });

  it('delivers and reports nothing once pdf.js aborts it', async () => {
    const onFailure = vi.fn();
    const pending: { fail: (error: Error) => void } = { fail: () => undefined };
    const ok = createRangeTransport(lib, reader(async (begin, end) => new Uint8Array(end - begin)), onFailure) as unknown as FakeBase;
    const failing = createRangeTransport(lib, reader(() => new Promise((_resolve, reject) => {
      pending.fail = reject;
    })), onFailure) as unknown as FakeBase;

    ok.requestDataRange(MIB, 2 * MIB);
    failing.requestDataRange(MIB, 2 * MIB);
    ok.abort();
    failing.abort();
    pending.fail(new Error('aborted'));
    await settle();

    expect(ok.delivered).toEqual([]);
    expect(onFailure).not.toHaveBeenCalled();
  });
});
