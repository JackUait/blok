import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerSource from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?raw';
import { createSafeObjectUrl } from '../../../shared/safe-object-url';

const SOURCE_MAP = /\s*\/\/# sourceMappingURL=\S*\s*$/;

const state = { workerSet: false };

/**
 * pdf.js looks for its worker file next to its own module. Bundled into Blok
 * there is no such file, so the worker runs from a blob.
 */
export const boot = (): typeof pdfjs => {
  if (!state.workerSet) {
    pdfjs.GlobalWorkerOptions.workerSrc = createSafeObjectUrl(
      new Blob([workerSource.replace(SOURCE_MAP, '')], { type: 'text/javascript' })
    );
    state.workerSet = true;
  }

  return pdfjs;
};
