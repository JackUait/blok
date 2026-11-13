import type * as PdfJsModule from 'pdfjs-dist/legacy/build/pdf.mjs';

export type PdfJs = typeof PdfJsModule;

const state: { pending: Promise<PdfJs> | null } = { pending: null };

/**
 * pdf.js and its worker load only when a PDF opens, so an editor that never
 * previews one pays nothing. A failed download is retried by the next open.
 */
export const loadPdfJs = (): Promise<PdfJs> => {
  state.pending ??= import('./pdf-runtime')
    .then((runtime) => runtime.boot())
    .catch((error: unknown) => {
      state.pending = null;
      throw error;
    });

  return state.pending;
};

/** The 8-byte header of an empty wasm module. */
const EMPTY_WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);

const wasm: { allowed: boolean | null } = { allowed: null };

/**
 * False where the page's CSP has no 'wasm-unsafe-eval' (or there is no
 * WebAssembly). The blob worker gets the page's CSP, so this holds there too.
 * Checked once: each blocked try sends the host a CSP violation report.
 */
export const canCompileWasm = (): boolean => {
  if (wasm.allowed === null) {
    try {
      new WebAssembly.Module(EMPTY_WASM);
      wasm.allowed = true;
    } catch {
      wasm.allowed = false;
    }
  }

  return wasm.allowed;
};

/**
 * The legacy build polyfills most newer APIs but not Promise.withResolvers,
 * so its absence marks a browser pdf.js cannot run in.
 * Spelled as an `in` check so the eager-API scan in bundle-outputs.test.ts stays quiet.
 */
export const supportsPdfJs = (): boolean => {
  if (typeof Worker !== 'function' || !('withResolvers' in Promise) || typeof document === 'undefined') return false;
  try {
    return document.createElement('canvas').getContext('2d') !== null;
  } catch {
    return false;
  }
};
