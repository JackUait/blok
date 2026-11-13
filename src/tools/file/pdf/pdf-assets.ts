import { PDF_ASSET_FILES } from './assets';

export { PDF_ASSET_FILES };

type Kind = keyof typeof PDF_ASSET_FILES;

const isKind = (kind: string): kind is Kind => Object.hasOwn(PDF_ASSET_FILES, kind);

/**
 * atob, not Uint8Array.fromBase64: Blok's browser floor lacks the latter.
 * atob skips the newlines the generated modules break their base64 with.
 */
function decode(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

/**
 * pdf.js's BinaryDataFactory: it reads cmaps, standard fonts and wasm decoders
 * from Blok's own lazy chunks, so no url is needed. pdf.js passes its url
 * options to the constructor; they are not used here.
 */
export class PdfAssetFactory {
  public async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    if (!isKind(kind)) {
      throw new Error(`Blok bundles no pdf.js ${kind} data`);
    }
    const files: Partial<Record<string, () => Promise<string>>> = PDF_ASSET_FILES[kind];
    const load = files[filename];
    if (load === undefined) {
      throw new Error(`Blok bundles no pdf.js file ${filename}`);
    }

    return decode(await load());
  }
}
