// Derived from @aiden0z/pptx-renderer 1.4.0 (Apache-2.0); modified for Blok. See NOTICE.
/* eslint-disable no-restricted-syntax, max-depth, no-param-reassign -- vendored upstream code: restyling it risks behaviour the parity suite cannot see */
/**
 * PPTX zip archive parser.
 * Extracts and categorizes all files from a .pptx (which is a zip archive).
 */

import { DEFAULT_ZIP_LIMITS, readZip } from '../../zip/read-zip';
import type { ZipArchive, ZipEntry } from '../../zip/read-zip';

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
}

export const RECOMMENDED_ZIP_LIMITS = Object.freeze({
  maxEntries: 4_000,
  maxEntryUncompressedBytes: 32 * 1024 * 1024,
  maxTotalUncompressedBytes: 256 * 1024 * 1024,
  maxMediaBytes: 192 * 1024 * 1024,
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

const utf8 = new TextDecoder('utf-8', { ignoreBOM: true });

/**
 * Reads one entry. The zip reader never inflates past the size the entry declares,
 * and every declared size was checked against the limits before any entry is read.
 */
function readZipTextEntry(archive: ZipArchive, entry: ZipEntry): string {
  return utf8.decode(archive.read(entry));
}

function readZipBinaryEntry(archive: ZipArchive, entry: ZipEntry): Uint8Array {
  return archive.read(entry);
}

/**
 * Parse a .pptx file buffer and extract all relevant files, categorized by type.
 */
export async function parseZip(
  buffer: ArrayBuffer,
  limits: ZipParseLimits = {},
): Promise<PptxFiles> {
  const archive = readZip(buffer, DEFAULT_ZIP_LIMITS);
  const entries = archive.entries.filter((entry) => !entry.dir);

  if (limits.maxEntries !== undefined && entries.length > limits.maxEntries) {
    throwZipLimitExceeded(`entries ${entries.length} > maxEntries ${limits.maxEntries}`);
  }

  let knownTotalBytes = 0;
  let knownMediaBytes = 0;

  for (const { name: rawPath, size } of entries) {
    const normalizedPath = rawPath.replace(/\\/g, '/');

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

  for (const file of entries) {
    categorize(file);
  }

  function categorize(file: ZipEntry): void {
    const normalizedPath = file.name.replace(/\\/g, '/');

    // --- Content Types ---
    if (normalizedPath === '[Content_Types].xml') {
      result.contentTypes = readZipTextEntry(archive, file);
      return;
    }

    // --- Presentation ---
    if (normalizedPath === 'ppt/presentation.xml') {
      result.presentation = readZipTextEntry(archive, file);
      return;
    }

    // --- Presentation Rels ---
    if (normalizedPath === 'ppt/_rels/presentation.xml.rels') {
      result.presentationRels = readZipTextEntry(archive, file);
      return;
    }

    // --- Table Styles ---
    if (normalizedPath === 'ppt/tableStyles.xml') {
      result.tableStyles = readZipTextEntry(archive, file);
      return;
    }

    // --- Media (binary) ---
    if (isMediaPath(normalizedPath)) {
      const bytes = readZipBinaryEntry(archive, file);
      setPathMapEntry(result.media, normalizedPath, bytes);
      return;
    }

    // --- Embedded fonts (binary EOT/.fntdata) ---
    if (/^ppt\/fonts\/[^/]+\.fntdata$/i.test(normalizedPath)) {
      const bytes = readZipBinaryEntry(archive, file);
      setPathMapEntry(fonts, normalizedPath, bytes);
      return;
    }

    // --- Slide Rels (must check before slides to avoid false match) ---
    if (/^ppt\/slides\/_rels\/[^/]+\.xml\.rels$/.test(normalizedPath)) {
      setPathMapEntry(
        result.slideRels,
        normalizedPath,
        readZipTextEntry(archive, file),
      );
      return;
    }

    // --- Slides ---
    if (/^ppt\/slides\/[^/]+\.xml$/.test(normalizedPath)) {
      setPathMapEntry(
        result.slides,
        normalizedPath,
        readZipTextEntry(archive, file),
      );
      return;
    }

    // --- Slide Layout Rels ---
    if (/^ppt\/slideLayouts\/_rels\/[^/]+\.xml\.rels$/.test(normalizedPath)) {
      setPathMapEntry(
        result.slideLayoutRels,
        normalizedPath,
        readZipTextEntry(archive, file),
      );
      return;
    }

    // --- Slide Layouts ---
    if (/^ppt\/slideLayouts\/[^/]+\.xml$/.test(normalizedPath)) {
      setPathMapEntry(
        result.slideLayouts,
        normalizedPath,
        readZipTextEntry(archive, file),
      );
      return;
    }

    // --- Slide Master Rels ---
    if (/^ppt\/slideMasters\/_rels\/[^/]+\.xml\.rels$/.test(normalizedPath)) {
      setPathMapEntry(
        result.slideMasterRels,
        normalizedPath,
        readZipTextEntry(archive, file),
      );
      return;
    }

    // --- Slide Masters ---
    if (/^ppt\/slideMasters\/[^/]+\.xml$/.test(normalizedPath)) {
      setPathMapEntry(
        result.slideMasters,
        normalizedPath,
        readZipTextEntry(archive, file),
      );
      return;
    }

    // --- Themes ---
    if (/^ppt\/theme\/(?!themeOverride[^/]*\.xml$)[^/]+\.xml$/.test(normalizedPath)) {
      setPathMapEntry(
        result.themes,
        normalizedPath,
        readZipTextEntry(archive, file),
      );
      return;
    }

    // --- Theme Overrides (used by chart parts) ---
    if (/^ppt\/theme\/themeOverride[^/]*\.xml$/.test(normalizedPath)) {
      if (result.themeOverrides) {
        setPathMapEntry(
          result.themeOverrides,
          normalizedPath,
          readZipTextEntry(archive, file),
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
          readZipTextEntry(archive, file),
        );
      }
      return;
    }

    // --- Charts ---
    if (/^ppt\/charts\/(?!style[^/]*\.xml$)(?!colors[^/]*\.xml$)[^/]+\.xml$/.test(normalizedPath)) {
      setPathMapEntry(
        result.charts,
        normalizedPath,
        readZipTextEntry(archive, file),
      );
      return;
    }

    // --- Chart Styles ---
    if (/^ppt\/charts\/style[^/]*\.xml$/.test(normalizedPath)) {
      setPathMapEntry(
        result.chartStyles,
        normalizedPath,
        readZipTextEntry(archive, file),
      );
      return;
    }

    // --- Chart Colors ---
    if (/^ppt\/charts\/colors[^/]*\.xml$/.test(normalizedPath)) {
      setPathMapEntry(
        result.chartColors,
        normalizedPath,
        readZipTextEntry(archive, file),
      );
      return;
    }

    // --- Diagram Drawings (SmartArt fallback) ---
    if (/^ppt\/diagrams\/[^/]+\.xml$/.test(normalizedPath)) {
      setPathMapEntry(
        result.diagramDrawings,
        normalizedPath,
        readZipTextEntry(archive, file),
      );
      return;
    }

  }

  return result;
}
