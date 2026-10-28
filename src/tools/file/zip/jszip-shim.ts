// Read-only stand-in for the slice of JSZip that @aiden0z/pptx-renderer uses; a yarn
// resolution points its `jszip` import here.
import { readZip } from './read-zip';
import type { ZipEntry } from './read-zip';
import { ZipError } from './zip-error';

// A part's BOM stays in its text; the renderer's XML parser accepts it.
const utf8 = new TextDecoder('utf-8', { ignoreBOM: true });

export interface ShimFile {
  readonly name: string;
  readonly dir: boolean;
  /** pptx-renderer reads this private JSZip field to check its limits before inflating. */
  readonly _data: { readonly uncompressedSize: number };
  async(type: 'string'): Promise<string>;
  async(type: 'uint8array'): Promise<Uint8Array>;
}

export interface ShimZip {
  /** Null prototype: entry names like "__proto__" are plain keys. */
  readonly files: Record<string, ShimFile>;
}

async function loadAsync(data: ArrayBuffer | Uint8Array): Promise<ShimZip> {
  const archive = readZip(data);
  const files = Object.create(null) as Record<string, ShimFile>;
  const output = (entry: ZipEntry, type: string): unknown => {
    switch (type) {
      case 'string':
        return utf8.decode(archive.read(entry));
      case 'uint8array':
        return archive.read(entry);
      default:
        throw new ZipError(`Unsupported output type: ${type}`);
    }
  };

  archive.entries.forEach((entry) => {
    files[entry.name] = {
      name: entry.name,
      dir: entry.dir,
      _data: { uncompressedSize: entry.size },
      async: ((type: string) => Promise.resolve().then(() => output(entry, type))) as ShimFile['async'],
    };
  });

  return { files };
}

export default { loadAsync };
