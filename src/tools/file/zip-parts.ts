import type JSZip from 'jszip';
import { loadZip } from './office-loaders';

/** Largest single part we inflate. Guards a small zip that inflates to gigabytes. */
const MAX_PART_BYTES = 64 * 1024 * 1024;
/** Most bytes we inflate across one document. */
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;

/** The package is too large to inflate safely. */
export class ZipLimitError extends Error {}

/** JSZip's per-entry stream; public in its docs, missing from its typings. */
interface StreamingEntry {
  internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>;
}

function isStreaming(file: JSZip.JSZipObject): file is JSZip.JSZipObject & StreamingEntry {
  return typeof (file as Partial<StreamingEntry>).internalStream === 'function';
}

function concat(chunks: Uint8Array[], size: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size);
  chunks.reduce((offset, chunk) => {
    out.set(chunk, offset);

    return offset + chunk.length;
  }, 0);

  return out;
}

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

  protected constructor(protected readonly zip: JSZip) {}

  static async open(buf: ArrayBuffer): Promise<ZipParts> {
    return new ZipParts(await ZipParts.load(buf));
  }

  protected static async load(buf: ArrayBuffer): Promise<JSZip> {
    const JSZipCtor = await loadZip();

    return JSZipCtor.loadAsync(buf);
  }

  /** Every entry path in the zip. */
  paths(): string[] {
    return Object.keys(this.zip.files);
  }

  /**
   * Inflate a part, counting the bytes as they come out. The sizes a zip
   * declares are not trusted: an entry claiming 10 bytes may inflate to gigabytes.
   */
  private inflate(file: JSZip.JSZipObject, path: string): Promise<Uint8Array<ArrayBuffer>> {
    if (!isStreaming(file)) {
      return Promise.reject(new Error('zip entries cannot be streamed'));
    }

    return new Promise((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      const part = { size: 0 };
      const stream = file.internalStream('uint8array');
      stream
        .on('data', (chunk) => {
          part.size += chunk.length;
          this.inflated += chunk.length;
          if (part.size > MAX_PART_BYTES || this.inflated > MAX_TOTAL_BYTES) {
            stream.pause();
            reject(new ZipLimitError(`${path} is too large to preview`));

            return;
          }
          chunks.push(chunk);
        })
        .on('error', reject)
        .on('end', () => resolve(concat(chunks, part.size)))
        .resume();
    });
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

  /** A part's raw bytes, or null when the package lacks it. */
  async bytes(path: string): Promise<Uint8Array<ArrayBuffer> | null> {
    const file = this.zip.file(path);

    return file === null ? null : this.inflate(file, path);
  }

}
