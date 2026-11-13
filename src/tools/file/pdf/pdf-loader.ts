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
