import type { PptxViewer } from '@aiden0z/pptx-renderer';
import type JSZip from 'jszip';

/** Dynamic-import docx-preview's renderAsync (code-split out of the main bundle). */
export async function loadDocxRenderer(): Promise<
  (data: ArrayBuffer, bodyContainer: HTMLElement) => Promise<void>
> {
  const mod = await import('docx-preview');

  return (data, bodyContainer) =>
    mod.renderAsync(data, bodyContainer, undefined, {
      inWrapper: true,
      className: 'blok-docx',
      // Shrink each page to its content height instead of enforcing the full
      // paper height — otherwise a half-page document leaves a tall white void.
      ignoreHeight: true,
    });
}

/**
 * Dynamic-import JSZip (code-split out of the main bundle). We parse .xlsx as a
 * raw OOXML zip rather than via a spreadsheet library: ExcelJS's reader breaks
 * when re-bundled by Vite (its worksheet reader throws on `_processWorksheetEntry`
 * once polyfills are double-bundled), and SheetJS dropped the npm registry. JSZip
 * is already pulled in (and proven in-browser) by docx-preview and pptx-renderer.
 */
export async function loadZip(): Promise<typeof JSZip> {
  const mod = await import('jszip');

  // JSZip is CJS — interop lands the constructor on `.default` under some
  // bundlers and at the top level under others. Accept either.
  const candidate = mod as unknown as { default?: typeof JSZip } & typeof JSZip;

  return candidate.default ?? candidate;
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
