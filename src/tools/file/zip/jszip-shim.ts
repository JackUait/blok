// Read-only stand-in for the slice of JSZip that docx-preview and
// @aiden0z/pptx-renderer use; the bundle aliases the `jszip` package to it.
// Writing (file(name, content), generateAsync) is left out: only docx-preview's
// save() reaches it, and Blok never calls save().
import { readZip } from './read-zip';
import type { ZipEntry } from './read-zip';
import { ZipError } from './zip-error';

// A part's BOM stays in its text; the libraries' XML parsers accept it.
const utf8 = new TextDecoder('utf-8', { ignoreBOM: true });

export interface ShimFile {
  readonly name: string;
  readonly dir: boolean;
  /** pptx-renderer reads this private JSZip field to check its limits before inflating. */
  readonly _data: { readonly uncompressedSize: number };
  async(type: 'string'): Promise<string>;
  async(type: 'uint8array'): Promise<Uint8Array>;
  async(type: 'blob'): Promise<Blob>;
}

export interface ShimZip {
  /** Null prototype: entry names like "__proto__" are plain keys. */
  readonly files: Record<string, ShimFile>;
  file(name: string): ShimFile | null;
}

async function loadAsync(data: ArrayBuffer | Uint8Array): Promise<ShimZip> {
  const archive = readZip(data);
  const files = Object.create(null) as Record<string, ShimFile>;
  // One inflate and one Blob per entry: docx-preview re-reads an image for every
  // reference to it. Each entry is cached once, so the reader's total limit bounds the cache.
  const cache = new Map<ZipEntry, Uint8Array<ArrayBuffer>>();
  const blobs = new Map<ZipEntry, Blob>();
  const bytesOf = (entry: ZipEntry): Uint8Array<ArrayBuffer> => {
    const bytes = cache.get(entry) ?? archive.read(entry);

    cache.set(entry, bytes);

    return bytes;
  };
  const blobOf = (entry: ZipEntry): Blob => {
    const blob = blobs.get(entry) ?? new Blob([bytesOf(entry)]);

    blobs.set(entry, blob);

    return blob;
  };
  const output = (entry: ZipEntry, type: string): unknown => {
    switch (type) {
      case 'string':
        return utf8.decode(bytesOf(entry));
      case 'uint8array':
        // A copy: docx-preview deobfuscates fonts in place on what it gets.
        return bytesOf(entry).slice();
      case 'blob':
        return blobOf(entry);
      default:
        throw new ZipError(`Unsupported output type: ${type}`);
    }
  };
  const toFile = (entry: ZipEntry): ShimFile => ({
    name: entry.name,
    dir: entry.dir,
    _data: { uncompressedSize: entry.size },
    async: ((type: string) => Promise.resolve().then(() => output(entry, type))) as ShimFile['async'],
  });

  archive.entries.forEach((entry) => {
    files[entry.name] = toFile(entry);
  });

  return {
    files,
    file: (name) => {
      const found = files[name];

      return found !== undefined && !found.dir ? found : null;
    },
  };
}

export default { loadAsync };
