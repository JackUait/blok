import { createHash } from 'node:crypto';

/** A stable, JSON-ready form of a library result: Maps sorted by key, bytes as sha256. */
export function normalize(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { sha256: createHash('sha256').update(value).digest('hex'), length: value.length };
  }
  if (value instanceof Map) {
    return Array.from(value.entries())
      .map(([key, item]: [unknown, unknown]) => [String(key), normalize(item)])
      .sort(([a], [b]) => (String(a) < String(b) ? -1 : 1));
  }
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(Reflect.get(value, key))]));
  }

  return value;
}

/** The options Blok's office-loaders.ts passes to docx-preview. */
export const DOCX_OPTIONS = { inWrapper: true, className: 'blok-docx', ignoreHeight: true, renderAltChunks: false };

export const OFFICE_CASES = {
  docx: 'fixtures/office-deflated/service-agreement.docx',
  pptx: 'fixtures/office-deflated/pitch-deck.pptx',
  xlsx: 'fixtures/jszip/complex_files/AntarcticaTemps.xlsx',
  docxImage: 'fixtures/office-deflated/service-agreement-image.docx',
  pptxImage: 'fixtures/office-deflated/pitch-deck-image.pptx',
} as const;

/**
 * Runs `render` with URL.createObjectURL swapped for one that records each blob and
 * hands out `blob:#<n>`, so the output is stable and the blob bytes can be compared.
 */
export async function withRecordedBlobs(render: () => Promise<string>): Promise<{ html: string; blobs: unknown[] }> {
  const blobs: Blob[] = [];
  const original = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: (blob: Blob): string => `blob:#${blobs.push(blob) - 1}`,
  });
  try {
    const html = await render();
    const described = await Promise.all(blobs.map(async (blob) => ({
      type: blob.type,
      bytes: normalize(new Uint8Array(await blob.arrayBuffer())),
    })));

    return { html, blobs: described };
  } finally {
    if (original !== undefined) {
      Object.defineProperty(URL, 'createObjectURL', original);
    }
  }
}

interface ListedFile {
  dir: boolean;
  _data?: unknown;
  async(type: 'uint8array'): Promise<Uint8Array>;
}

/**
 * The listing pptx-renderer builds: non-dir files, the private uncompressed size it
 * checks limits with, and the bytes. JSZip leaves the size out on empty files where
 * the shim says 0, which the renderer treats the same, so both map to null.
 */
export async function listLikePptxRenderer(zip: { files: Record<string, ListedFile> }): Promise<unknown> {
  const listed = [];

  for (const [name, file] of Object.entries(zip.files).filter(([, f]) => !f.dir)) {
    const size: unknown = typeof file._data === 'object' && file._data !== null ? Reflect.get(file._data, 'uncompressedSize') : undefined;

    listed.push({ name, size: typeof size === 'number' && size > 0 ? size : null, bytes: normalize(await file.async('uint8array')) });
  }

  return listed;
}
