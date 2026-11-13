import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerSource from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?raw';
import { createSafeObjectUrl } from '../../../shared/safe-object-url';
import { canCompileWasm } from './pdf-loader';

const SOURCE_MAP = /\s*\/\/# sourceMappingURL=\S*\s*$/;

/**
 * The one spot where pdf.js's worker loads a JS image decoder (JBIG2, CCITT,
 * JPEG 2000) when wasm cannot run. It imports by `wasmUrl`, which Blok does
 * not set. pdf-runtime.test.ts fails when a pdfjs-dist upgrade moves it.
 */
export const FALLBACK_IMPORT = 'import(\n/*webpackIgnore: true*/\n/*@vite-ignore*/\n`${WasmImage.#_}${this._noWasmFilename}`)';

const FALLBACK_TABLE = '__blokPdfDecoders';
const DEFAULT_EXPORT = 'export default function';

/**
 * The worker source with the JS decoders built in, so it needs no import.
 * Null when the worker or a decoder is not shaped as expected: the plain
 * worker then still shows every PDF, only without those images.
 */
export function withFallbacks(worker: string, decoders: Record<string, string>): string | null {
  if (worker.split(FALLBACK_IMPORT).length !== 2) {
    return null;
  }
  const entries: string[] = [];
  for (const [name, code] of Object.entries(decoders)) {
    // One `export default function` and nothing else to link.
    if (code.split(DEFAULT_EXPORT).length !== 2 || /^\s*(?:import|export)\b/m.test(code.replace(DEFAULT_EXPORT, ''))) {
      return null;
    }
    entries.push(`${JSON.stringify(name)}: (() => { ${code.replace(DEFAULT_EXPORT, 'return function')} })()`);
  }
  const table = `const ${FALLBACK_TABLE} = { ${entries.join(', ')} };\n`;

  return table + worker.replace(FALLBACK_IMPORT, `Promise.resolve({ default: ${FALLBACK_TABLE}[this._noWasmFilename] })`);
}

const loadDecoders = async (): Promise<Record<string, string>> => {
  const [jbig2, openjpeg] = await Promise.all([
    import('pdfjs-dist/wasm/jbig2_nowasm_fallback.js?raw'),
    import('pdfjs-dist/wasm/openjpeg_nowasm_fallback.js?raw'),
  ]);

  return { 'jbig2_nowasm_fallback.js': jbig2.default, 'openjpeg_nowasm_fallback.js': openjpeg.default };
};

const state = { workerSet: false };

/**
 * pdf.js looks for its worker file next to its own module. Bundled into Blok
 * there is no such file, so the worker runs from a blob. Where the page's CSP
 * blocks wasm, the blob also carries the JS decoders: the CSP that blocks
 * wasm blocks importing them from a blob or data url too.
 */
export const boot = async (): Promise<typeof pdfjs> => {
  if (!state.workerSet) {
    const plain = workerSource.replace(SOURCE_MAP, '');
    const source = canCompileWasm() ? plain : withFallbacks(plain, await loadDecoders()) ?? plain;
    pdfjs.GlobalWorkerOptions.workerSrc = createSafeObjectUrl(new Blob([source], { type: 'text/javascript' }));
    state.workerSet = true;
  }

  return pdfjs;
};
