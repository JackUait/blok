import { loadZipReader } from './office-loaders';
import type { ZipArchive, ZipEntry } from './zip/read-zip';

/** Largest single part we inflate. Guards a small zip that inflates to gigabytes. */
const MAX_PART_BYTES = 64 * 1024 * 1024;
/** Most bytes we inflate across one document. */
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;

/** The package is too large to inflate safely. */
export class ZipLimitError extends Error {}

/** Parse XML, refusing DTDs (entity expansion) and malformed markup. */
export function parseXml(text: string, path: string): Document {
  // Checked before parsing, so an entity bomb never reaches the parser.
  if (/<!DOCTYPE/i.test(text)) {
    throw new Error(`${path} declares a DOCTYPE`);
  }
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.doctype !== null) {
    throw new Error(`${path} declares a DOCTYPE`);
  }
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error(`${path} is not well-formed XML`);
  }

  return doc;
}


/**
 * Guarded reads of the parts of an Office zip (docx, xlsx): bytes are counted
 * as they inflate, and XML with a DOCTYPE is refused.
 */
export class ZipParts {
  private inflated = 0;

  protected constructor(protected readonly zip: ZipArchive) {}

  static async open(buf: ArrayBuffer): Promise<ZipParts> {
    return new ZipParts(await ZipParts.load(buf));
  }

  protected static async load(buf: ArrayBuffer): Promise<ZipArchive> {
    const readZip = await loadZipReader();

    return readZip(buf);
  }

  /** Every entry path in the zip. */
  paths(): string[] {
    return this.zip.entries.map((entry) => entry.name);
  }

  /** Whether the package has a file at `path`. */
  has(path: string): boolean {
    const entry = this.entry(path);

    return entry !== undefined && !entry.dir;
  }

  /** Some zip tools store `word\document.xml`; the old docx-preview opened those, so we keep doing it. */
  private entry(path: string): ZipEntry | undefined {
    return this.zip.get(path) ?? this.zip.get(path.replace(/\//g, '\\'));
  }

  /** A part's XML, or null when the package lacks it. */
  async xml(path: string): Promise<Document | null> {
    const bytes = await this.bytes(path);

    return bytes === null ? null : parseXml(new TextDecoder().decode(bytes), path);
  }

  /**
   * A side part's XML, or null when it is missing or unreadable: a broken
   * optional part costs its own content, not the whole preview. Size limits
   * still throw.
   */
  async optionalXml(path: string): Promise<Document | null> {
    try {
      return await this.xml(path);
    } catch (error) {
      if (error instanceof ZipLimitError) {
        throw error;
      }

      return null;
    }
  }

  /**
   * A part's raw bytes, or null when the package lacks it. The declared size is
   * exact: the reader's inflate refuses to write past it, so a lying entry throws.
   */
  async bytes(path: string): Promise<Uint8Array<ArrayBuffer> | null> {
    const entry = this.entry(path);
    if (entry === undefined || entry.dir) {
      return null;
    }
    this.inflated += entry.size;
    if (entry.size > MAX_PART_BYTES || this.inflated > MAX_TOTAL_BYTES) {
      throw new ZipLimitError(`${path} is too large to preview`);
    }

    return this.zip.read(entry);
  }
}
