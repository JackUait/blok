import type { PptxViewer } from '@aiden0z/pptx-renderer';
import type { readZip } from './zip/read-zip';

/**
 * Dynamic-import the in-house docx renderer (code-split out of the main bundle).
 * Rendering resolves with a function that frees the images' blob URLs.
 */
export async function loadDocxRenderer(): Promise<
  (data: ArrayBuffer, bodyContainer: HTMLElement) => Promise<() => void>
> {
  const mod = await import('./docx');

  return (data, bodyContainer) => mod.renderDocxInto(data, bodyContainer);
}

/**
 * Dynamic-import the zip reader (code-split out of the main bundle). We parse .xlsx as a
 * raw OOXML zip rather than via a spreadsheet library: ExcelJS's reader breaks
 * when re-bundled by Vite (its worksheet reader throws on `_processWorksheetEntry`
 * once polyfills are double-bundled), and SheetJS dropped the npm registry. The
 * docx renderer reads its package with it too.
 */
export async function loadZipReader(): Promise<typeof readZip> {
  return (await import('./zip/read-zip')).readZip;
}

/** Dynamic-import pptx-renderer's viewer + recommended zip limits. */
export async function loadPptxRenderer(): Promise<{
  open: (buf: ArrayBuffer, container: HTMLElement) => Promise<PptxViewer>;
}> {
  const mod = await import('@aiden0z/pptx-renderer');

  return {
    open: (buf, container) =>
      mod.PptxViewer.open(buf, container, {
        // Scale every slide to the container width and re-fit on resize; without
        // it the renderer lays slides out at their intrinsic 960×720, which the
        // modal's scroll container then clips down to the title band.
        fitMode: 'contain',
        zipLimits: mod.RECOMMENDED_ZIP_LIMITS,
        pdfjs: false,
      }),
  };
}
