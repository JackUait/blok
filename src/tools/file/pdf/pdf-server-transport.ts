import type { FileConfig } from '../../../../types/tools/file';
import { PdfUnreadableError } from './pdf-errors';
import type { PdfJs } from './pdf-loader';
import type { PdfSource } from './pdf-preview';

/** The Blok server answers at most 1 MiB per request (413 above), so no range is longer. */
export const SERVER_CHUNK_BYTES = 1_048_576;

type HeaderSource = NonNullable<FileConfig['previewEndpoint']>['headers'];

/** The file's bytes, read in ranges on demand. `end` is exclusive. */
export interface RangeReader {
  length: number;
  initial: Uint8Array;
  read(begin: number, end: number): Promise<Uint8Array>;
}

const CONTENT_RANGE = /^bytes (\d+)-(\d+)\/(\d+|\*)$/;

/** A 206 answer's place in the file, when it holds exactly the bytes it claims. */
function extentOf(response: Response, body: Uint8Array): { start: number; total: number | null } | null {
  const match = CONTENT_RANGE.exec(response.headers.get('Content-Range') ?? '');
  if (match === null) {
    return null;
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (end - start + 1 !== body.length) {
    return null;
  }

  return { start, total: match[3] === '*' ? null : Number(match[3]) };
}

/**
 * Reads an http(s) PDF through a Blok server's /file-bytes route. Null when
 * the route cannot help (off, unreachable, refused): the preview then offers
 * the link. Rejects with PdfUnreadableError when the server says it is no PDF.
 */
export async function createServerRangeSource(
  endpoint: string,
  url: string,
  headers: HeaderSource,
  signal: AbortSignal,
): Promise<PdfSource | null> {
  const target = `${endpoint}?url=${encodeURIComponent(url)}`;
  // Minted per request: a ticket may expire while the reader scrolls.
  const get = async (first: number, last: number): Promise<Response> => {
    const minted = typeof headers === 'function' ? await headers() : headers;

    return fetch(target, { headers: { ...minted, Range: `bytes=${first}-${last}` }, signal });
  };
  const piece = async (first: number, last: number): Promise<Uint8Array> => {
    const response = await get(first, last);
    const body = new Uint8Array(await response.arrayBuffer());
    const extent = response.status === 206 ? extentOf(response, body) : null;
    // A wrong offset would not throw later; it would draw garbage.
    if (extent?.start !== first || body.length !== last - first + 1) {
      throw new Error(`file-bytes answered ${response.status} for bytes ${first}-${last}`);
    }

    return body;
  };

  const response = await get(0, SERVER_CHUNK_BYTES - 1).catch(() => null);
  if (response === null) {
    return null;
  }
  if (response.status === 415) {
    throw new PdfUnreadableError('file-bytes: not a pdf');
  }
  if (response.status !== 200 && response.status !== 206) {
    return null;
  }
  const initial = new Uint8Array(await response.arrayBuffer());
  if (response.status === 200) {
    return { kind: 'data', data: initial };
  }
  const extent = extentOf(response, initial);
  if (extent === null || extent.start !== 0 || extent.total === null) {
    return null;
  }
  if (initial.length >= extent.total) {
    return { kind: 'data', data: initial };
  }

  return {
    kind: 'transport',
    reader: {
      length: extent.total,
      initial,
      read: async (begin, end) => {
        const starts = Array.from({ length: Math.ceil((end - begin) / SERVER_CHUNK_BYTES) }, (_, i) => begin + i * SERVER_CHUNK_BYTES);
        const pieces = await Promise.all(starts.map((at) => piece(at, Math.min(at + SERVER_CHUNK_BYTES, end) - 1)));
        const joined = new Uint8Array(end - begin);
        pieces.forEach((part, index) => joined.set(part, starts[index] - begin));

        return joined;
      },
    },
  };
}

/**
 * pdf.js's PDFDataRangeTransport over a RangeReader. It must subclass the
 * loaded lib's own class: getDocument ignores a `range` that is not one.
 * pdf.js takes exactly one answer per requested range, and has no way to be
 * told a range failed, so `onFailure` reports it instead.
 */
export function createRangeTransport(
  lib: Pick<PdfJs, 'PDFDataRangeTransport'>,
  reader: RangeReader,
  onFailure: (error: unknown) => void,
): InstanceType<PdfJs['PDFDataRangeTransport']> {
  const state = { aborted: false };

  class ServerRangeTransport extends lib.PDFDataRangeTransport {
    public override requestDataRange(begin: number, end: number): void {
      reader.read(begin, end).then((chunk) => {
        if (!state.aborted) {
          this.onDataRange(begin, chunk);
        }
      }, (error: unknown) => {
        if (!state.aborted) {
          onFailure(error);
        }
      });
    }

    public override abort(): void {
      state.aborted = true;
    }
  }

  return new ServerRangeTransport(reader.length, reader.initial);
}
