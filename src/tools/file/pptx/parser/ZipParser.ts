// Derived from @aiden0z/pptx-renderer 1.4.0 (Apache-2.0); modified for Blok. See NOTICE.
/* eslint-disable no-restricted-syntax, max-depth, no-param-reassign -- vendored upstream code: restyling it risks behaviour the parity suite cannot see */
/**
 * PPTX zip archive parser.
 * Extracts and categorizes all files from a .pptx (which is a zip archive).
 */

import JSZip from 'jszip';
import type { JSZipObject } from 'jszip';

export interface PptxFiles {
  contentTypes: string;
  presentation: string;
  presentationRels: string;
  slides: Map<string, string>;
  slideRels: Map<string, string>;
  slideLayouts: Map<string, string>;
  slideLayoutRels: Map<string, string>;
  slideMasters: Map<string, string>;
  slideMasterRels: Map<string, string>;
  themes: Map<string, string>;
  themeOverrides?: Map<string, string>;
  media: Map<string, Uint8Array>;
  /** Embedded EOT font parts under ppt/fonts/. */
  fonts?: Map<string, Uint8Array>;
  tableStyles?: string;
  charts: Map<string, string>; // ppt/charts/chart*.xml
  chartRels?: Map<string, string>; // ppt/charts/_rels/chart*.xml.rels
  chartStyles: Map<string, string>; // ppt/charts/style*.xml
  chartColors: Map<string, string>; // ppt/charts/colors*.xml
  diagramDrawings: Map<string, string>; // ppt/diagrams/drawing*.xml (SmartArt fallback)
}

export interface ZipParseLimits {
  /** Maximum number of non-directory entries in the zip archive. */
  maxEntries?: number;
  /** Maximum uncompressed size for any single entry (bytes). */
  maxEntryUncompressedBytes?: number;
  /** Maximum total uncompressed size across all entries (bytes). */
  maxTotalUncompressedBytes?: number;
  /** Maximum uncompressed size across media entries under `ppt/media/` (bytes). */
  maxMediaBytes?: number;
  /** Maximum concurrent zip entry reads during parsing. */
  maxConcurrency?: number;
}

export const RECOMMENDED_ZIP_LIMITS = Object.freeze({
  maxEntries: 4_000,
  maxEntryUncompressedBytes: 32 * 1024 * 1024,
  maxTotalUncompressedBytes: 256 * 1024 * 1024,
  maxMediaBytes: 192 * 1024 * 1024,
  maxConcurrency: 8,
}) satisfies Required<ZipParseLimits>;

function throwZipLimitExceeded(reason: string): never {
  throw new Error(`PPTX zip limit exceeded: ${reason}`);
}

function isMediaPath(path: string): boolean {
  return path.startsWith('ppt/media/');
}

function decodeZipPath(path: string): string {
  return path
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join('/');
}

function setPathMapEntry<T>(map: Map<string, T>, path: string, value: T): void {
  map.set(path, value);
  const decodedPath = decodeZipPath(path);
  if (decodedPath !== path && !map.has(decodedPath)) {
    map.set(decodedPath, value);
  }
}

function readUncompressedSize(file: JSZipObject): number | undefined {
  const data = (file as unknown as { _data?: { uncompressedSize?: number } })._data;
  const size = data?.uncompressedSize;
  return typeof size === 'number' && Number.isFinite(size) ? size : undefined;
}

interface ZipLimitState {
  limits: ZipParseLimits;
  knownSizeByPath: Map<string, number>;
  /** Bytes actually inflated so far; zip headers can lie about sizes. */
  inflatedTotalBytes: number;
  inflatedMediaBytes: number;
  /** Set once any entry fails, so the other workers stop reading. */
  failed: boolean;
}

interface ZipChunkStream {
  on(event: 'data', listener: (chunk: Uint8Array) => void): ZipChunkStream;
  on(event: 'end', listener: () => void): ZipChunkStream;
  on(event: 'error', listener: (error: Error) => void): ZipChunkStream;
  pause(): ZipChunkStream;
  resume(): ZipChunkStream;
}

interface StreamingZipObject {
  internalStream(type: 'uint8array'): ZipChunkStream;
}

/** JSZip's chunked reader; its typings leave it out. */
function streamOf(file: JSZipObject): ZipChunkStream {
  return (file as JSZipObject & StreamingZipObject).internalStream('uint8array');
}

/** Charges inflated bytes to the limits; throws once any limit is passed. */
function chargeInflatedBytes(path: string, entryBytes: number, chunkBytes: number, state: ZipLimitState): void {
  const { limits } = state;

  if (limits.maxEntryUncompressedBytes !== undefined && entryBytes > limits.maxEntryUncompressedBytes) {
    throwZipLimitExceeded(
      `${path} inflates past maxEntryUncompressedBytes ${limits.maxEntryUncompressedBytes}`,
    );
  }

  state.inflatedTotalBytes += chunkBytes;
  if (
    limits.maxTotalUncompressedBytes !== undefined &&
    state.inflatedTotalBytes > limits.maxTotalUncompressedBytes
  ) {
    throwZipLimitExceeded(
      `total uncompressed bytes ${state.inflatedTotalBytes} > maxTotalUncompressedBytes ${limits.maxTotalUncompressedBytes}`,
    );
  }

  if (isMediaPath(path)) {
    state.inflatedMediaBytes += chunkBytes;
    if (limits.maxMediaBytes !== undefined && state.inflatedMediaBytes > limits.maxMediaBytes) {
      throwZipLimitExceeded(`media bytes ${state.inflatedMediaBytes} > maxMediaBytes ${limits.maxMediaBytes}`);
    }
  }
}

/**
 * Inflates one entry chunk by chunk and stops as soon as a limit is passed, so an
 * entry whose header declares 100 bytes cannot inflate gigabytes first.
 */
async function inflateEntry(path: string, file: JSZipObject, state: ZipLimitState): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const read = { bytes: 0 };
  const stopped = (): Error => new Error(`PPTX zip parse stopped before ${path}: another entry failed`);

  if (state.failed) throw stopped();

  await new Promise<void>((resolve, reject) => {
    const stream = streamOf(file);

    stream
      .on('data', (chunk) => {
        if (state.failed) {
          stream.pause();
          reject(stopped());

          return;
        }
        read.bytes += chunk.byteLength;
        try {
          chargeInflatedBytes(path, read.bytes, chunk.byteLength, state);
          chunks.push(chunk);
        } catch (error) {
          stream.pause();
          reject(error);
        }
      })
      .on('error', reject)
      .on('end', resolve)
      .resume();
  });

  const bytes = new Uint8Array(read.bytes);

  chunks.reduce((offset, chunk) => {
    bytes.set(chunk, offset);

    return offset + chunk.byteLength;
  }, 0);

  return bytes;
}

async function readZipTextEntry(
  path: string,
  file: JSZipObject,
  state: ZipLimitState,
): Promise<string> {
  // ignoreBOM keeps a leading BOM in the text, as JSZip's own string decoding did.
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(await inflateEntry(path, file, state));
}

async function readZipBinaryEntry(
  path: string,
  file: JSZipObject,
  state: ZipLimitState,
): Promise<Uint8Array> {
  return inflateEntry(path, file, state);
}

async function countUncategorizedEntryIfNeeded(
  path: string,
  file: JSZipObject,
  state: ZipLimitState,
): Promise<void> {
  if (state.knownSizeByPath.has(path)) return;
  if (
    state.limits.maxEntryUncompressedBytes === undefined &&
    state.limits.maxTotalUncompressedBytes === undefined
  ) {
    return;
  }

  await inflateEntry(path, file, state);
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  state: ZipLimitState,
  mapper: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const workerCount = Math.min(concurrency, items.length);
  let cursor = 0;

  // Promise.all rejects on the first failure but the other workers keep going,
  // so the flag stops them taking new entries and stops their open streams.
  const workers = Array.from({ length: workerCount }, async () => {
    while (!state.failed) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        await mapper(items[index]);
      } catch (error) {
        state.failed = true;
        throw error;
      }
    }
  });

  await Promise.all(workers);
}

/**
 * Parse a .pptx file buffer and extract all relevant files, categorized by type.
 */
export async function parseZip(
  buffer: ArrayBuffer,
  limits: ZipParseLimits = {},
): Promise<PptxFiles> {
  const maxConcurrency = limits.maxConcurrency ?? 8;
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throwZipLimitExceeded(`maxConcurrency ${limits.maxConcurrency} must be an integer >= 1`);
  }

  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.entries(zip.files).filter(([, file]) => !file.dir);

  if (limits.maxEntries !== undefined && entries.length > limits.maxEntries) {
    throwZipLimitExceeded(`entries ${entries.length} > maxEntries ${limits.maxEntries}`);
  }

  const knownSizeByPath = new Map<string, number>();
  let knownTotalBytes = 0;
  let knownMediaBytes = 0;

  for (const [rawPath, file] of entries) {
    const normalizedPath = rawPath.replace(/\\/g, '/');
    const size = readUncompressedSize(file);
    if (size === undefined) continue;

    knownSizeByPath.set(normalizedPath, size);

    if (limits.maxEntryUncompressedBytes !== undefined && size > limits.maxEntryUncompressedBytes) {
      throwZipLimitExceeded(
        `${normalizedPath} is ${size} bytes > maxEntryUncompressedBytes ${limits.maxEntryUncompressedBytes}`,
      );
    }

    knownTotalBytes += size;
    if (
      limits.maxTotalUncompressedBytes !== undefined &&
      knownTotalBytes > limits.maxTotalUncompressedBytes
    ) {
      throwZipLimitExceeded(
        `total uncompressed bytes ${knownTotalBytes} > maxTotalUncompressedBytes ${limits.maxTotalUncompressedBytes}`,
      );
    }

    if (isMediaPath(normalizedPath)) {
      knownMediaBytes += size;
      if (limits.maxMediaBytes !== undefined && knownMediaBytes > limits.maxMediaBytes) {
        throwZipLimitExceeded(
          `media bytes ${knownMediaBytes} > maxMediaBytes ${limits.maxMediaBytes}`,
        );
      }
    }
  }

  const fonts = new Map<string, Uint8Array>();
  const result: PptxFiles = {
    contentTypes: '',
    presentation: '',
    presentationRels: '',
    slides: new Map(),
    slideRels: new Map(),
    slideLayouts: new Map(),
    slideLayoutRels: new Map(),
    slideMasters: new Map(),
    slideMasterRels: new Map(),
    themes: new Map(),
    themeOverrides: new Map(),
    media: new Map(),
    fonts,
    charts: new Map(),
    chartRels: new Map(),
    chartStyles: new Map(),
    chartColors: new Map(),
    diagramDrawings: new Map(),
  };

  const limitState: ZipLimitState = {
    limits,
    knownSizeByPath,
    inflatedTotalBytes: 0,
    inflatedMediaBytes: 0,
    failed: false,
  };

  await mapWithConcurrency(entries, maxConcurrency, limitState, async ([path, file]) => {
    const normalizedPath = path.replace(/\\/g, '/');

    // --- Content Types ---
    if (normalizedPath === '[Content_Types].xml') {
      result.contentTypes = await readZipTextEntry(normalizedPath, file, limitState);
      return;
    }

    // --- Presentation ---
    if (normalizedPath === 'ppt/presentation.xml') {
      result.presentation = await readZipTextEntry(normalizedPath, file, limitState);
      return;
    }

    // --- Presentation Rels ---
    if (normalizedPath === 'ppt/_rels/presentation.xml.rels') {
      result.presentationRels = await readZipTextEntry(normalizedPath, file, limitState);
      return;
    }

    // --- Table Styles ---
    if (normalizedPath === 'ppt/tableStyles.xml') {
      result.tableStyles = await readZipTextEntry(normalizedPath, file, limitState);
      return;
    }

    // --- Media (binary) ---
    if (isMediaPath(normalizedPath)) {
      const bytes = await readZipBinaryEntry(normalizedPath, file, limitState);
      setPathMapEntry(result.media, normalizedPath, bytes);
      return;
    }

    // --- Embedded fonts (binary EOT/.fntdata) ---
    if (/^ppt\/fonts\/[^/]+\.fntdata$/i.test(normalizedPath)) {
      const bytes = await readZipBinaryEntry(normalizedPath, file, limitState);
      setPathMapEntry(fonts, normalizedPath, bytes);
      return;
    }

    // --- Slide Rels (must check before slides to avoid false match) ---
    if (/^ppt\/slides\/_rels\/[^/]+\.xml\.rels$/.test(normalizedPath)) {
      setPathMapEntry(
        result.slideRels,
        normalizedPath,
        await readZipTextEntry(normalizedPath, file, limitState),
      );
      return;
    }

    // --- Slides ---
    if (/^ppt\/slides\/[^/]+\.xml$/.test(normalizedPath)) {
      setPathMapEntry(
        result.slides,
        normalizedPath,
        await readZipTextEntry(normalizedPath, file, limitState),
      );
      return;
    }

    // --- Slide Layout Rels ---
    if (/^ppt\/slideLayouts\/_rels\/[^/]+\.xml\.rels$/.test(normalizedPath)) {
      setPathMapEntry(
        result.slideLayoutRels,
        normalizedPath,
        await readZipTextEntry(normalizedPath, file, limitState),
      );
      return;
    }

    // --- Slide Layouts ---
    if (/^ppt\/slideLayouts\/[^/]+\.xml$/.test(normalizedPath)) {
      setPathMapEntry(
        result.slideLayouts,
        normalizedPath,
        await readZipTextEntry(normalizedPath, file, limitState),
      );
      return;
    }

    // --- Slide Master Rels ---
    if (/^ppt\/slideMasters\/_rels\/[^/]+\.xml\.rels$/.test(normalizedPath)) {
      setPathMapEntry(
        result.slideMasterRels,
        normalizedPath,
        await readZipTextEntry(normalizedPath, file, limitState),
      );
      return;
    }

    // --- Slide Masters ---
    if (/^ppt\/slideMasters\/[^/]+\.xml$/.test(normalizedPath)) {
      setPathMapEntry(
        result.slideMasters,
        normalizedPath,
        await readZipTextEntry(normalizedPath, file, limitState),
      );
      return;
    }

    // --- Themes ---
    if (/^ppt\/theme\/(?!themeOverride[^/]*\.xml$)[^/]+\.xml$/.test(normalizedPath)) {
      setPathMapEntry(
        result.themes,
        normalizedPath,
        await readZipTextEntry(normalizedPath, file, limitState),
      );
      return;
    }

    // --- Theme Overrides (used by chart parts) ---
    if (/^ppt\/theme\/themeOverride[^/]*\.xml$/.test(normalizedPath)) {
      if (result.themeOverrides) {
        setPathMapEntry(
          result.themeOverrides,
          normalizedPath,
          await readZipTextEntry(normalizedPath, file, limitState),
        );
      }
      return;
    }

    // --- Chart Rels ---
    if (/^ppt\/charts\/_rels\/[^/]+\.xml\.rels$/.test(normalizedPath)) {
      if (result.chartRels) {
        setPathMapEntry(
          result.chartRels,
          normalizedPath,
          await readZipTextEntry(normalizedPath, file, limitState),
        );
      }
      return;
    }

    // --- Charts ---
    if (/^ppt\/charts\/(?!style[^/]*\.xml$)(?!colors[^/]*\.xml$)[^/]+\.xml$/.test(normalizedPath)) {
      setPathMapEntry(
        result.charts,
        normalizedPath,
        await readZipTextEntry(normalizedPath, file, limitState),
      );
      return;
    }

    // --- Chart Styles ---
    if (/^ppt\/charts\/style[^/]*\.xml$/.test(normalizedPath)) {
      setPathMapEntry(
        result.chartStyles,
        normalizedPath,
        await readZipTextEntry(normalizedPath, file, limitState),
      );
      return;
    }

    // --- Chart Colors ---
    if (/^ppt\/charts\/colors[^/]*\.xml$/.test(normalizedPath)) {
      setPathMapEntry(
        result.chartColors,
        normalizedPath,
        await readZipTextEntry(normalizedPath, file, limitState),
      );
      return;
    }

    // --- Diagram Drawings (SmartArt fallback) ---
    if (/^ppt\/diagrams\/[^/]+\.xml$/.test(normalizedPath)) {
      setPathMapEntry(
        result.diagramDrawings,
        normalizedPath,
        await readZipTextEntry(normalizedPath, file, limitState),
      );
      return;
    }

    await countUncategorizedEntryIfNeeded(normalizedPath, file, limitState);
  });

  return result;
}
