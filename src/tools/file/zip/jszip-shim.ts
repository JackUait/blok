// Read-only stand-in for the slice of JSZip that docx-preview and
// @aiden0z/pptx-renderer use; the bundle aliases the `jszip` package to it.
// Writing (file(name, content), generateAsync) is left out: only docx-preview's
// save() reaches it, and Blok never calls save().
import { readZip } from './read-zip';
import type { ZipEntry } from './read-zip';
import { ZipError } from './zip-error';

// JSZip kept a BOM in text; an XML parser handed the BOM still reads the part.
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

function convert(bytes: Uint8Array<ArrayBuffer>, type: string): unknown {
  switch (type) {
    case 'string':
      return utf8.decode(bytes);
    case 'uint8array':
      return bytes;
    case 'blob':
      return new Blob([bytes]);
    default:
      throw new ZipError(`Unsupported output type: ${type}`);
  }
}

async function loadAsync(data: ArrayBuffer | Uint8Array): Promise<ShimZip> {
  const archive = readZip(data);
  const files = Object.create(null) as Record<string, ShimFile>;
  const toFile = (entry: ZipEntry): ShimFile => ({
    name: entry.name,
    dir: entry.dir,
    _data: { uncompressedSize: entry.size },
    async: ((type: string) => Promise.resolve().then(() => convert(archive.read(entry), type))) as ShimFile['async'],
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
