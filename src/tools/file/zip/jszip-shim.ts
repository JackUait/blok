// Read-only stand-in for the slice of JSZip that docx-preview and
// @aiden0z/pptx-renderer use; the bundle aliases the `jszip` package to it.
import { readZip } from './read-zip';
import type { ZipEntry } from './read-zip';
import { ZipError } from './zip-error';

// Keeps a BOM, as JSZip did.
const utf8 = new TextDecoder('utf-8', { ignoreBOM: true });

export interface ShimFile {
  readonly name: string;
  readonly dir: boolean;
  /** pptx-renderer reads this private JSZip field to check its limits before inflating. */
  readonly _data: { readonly uncompressedSize: number };
  async(type: 'string' | 'text'): Promise<string>;
  async(type: 'uint8array'): Promise<Uint8Array>;
  async(type: 'arraybuffer'): Promise<ArrayBuffer>;
  async(type: 'blob'): Promise<Blob>;
  async(type: string): Promise<unknown>;
}

export interface ShimZip {
  /** Null prototype: entry names like "__proto__" are plain keys. */
  readonly files: Record<string, ShimFile>;
  file(name: string): ShimFile | null;
  file(name: string, content: unknown): never;
  generateAsync(options?: unknown): Promise<never>;
}

const notSupported = (what: string): ZipError => new ZipError(`${what} is not supported: Blok reads zips only`);

function convert(bytes: Uint8Array<ArrayBuffer>, type: string): unknown {
  switch (type.toLowerCase()) {
    case 'string':
    case 'text':
      return utf8.decode(bytes);
    case 'uint8array':
      return bytes;
    case 'arraybuffer':
      return bytes.buffer;
    case 'blob':
      return new Blob([bytes]);
    default:
      throw new ZipError(`Unsupported output type: ${type}`);
  }
}

const isBlob = (data: unknown): data is Blob => typeof Blob !== 'undefined' && data instanceof Blob;

async function loadAsync(data: ArrayBuffer | Uint8Array | Blob): Promise<ShimZip> {
  const bytes = isBlob(data) ? new Uint8Array(await data.arrayBuffer()) : data;
  const archive = readZip(bytes);
  const files = Object.create(null) as Record<string, ShimFile>;
  const toFile = (entry: ZipEntry): ShimFile => ({
    name: entry.name,
    dir: entry.dir,
    _data: { uncompressedSize: entry.size },
    // archive.read hands back a buffer of its own, so `arraybuffer` is exactly the content.
    async: ((type: string) => Promise.resolve().then(() => convert(archive.read(entry), type))) as ShimFile['async'],
  });

  archive.entries.forEach((entry) => {
    files[entry.name] = toFile(entry);
  });

  function file(name: string): ShimFile | null;
  function file(name: string, content: unknown): never;
  function file(name: string, ...content: unknown[]): ShimFile | null {
    if (content.length > 0) {
      throw notSupported('Writing to a zip');
    }
    const found = files[name];

    return found !== undefined && !found.dir ? found : null;
  }

  return {
    files,
    file,
    generateAsync: () => Promise.reject(notSupported('Generating a zip')),
  };
}

export default { loadAsync };
