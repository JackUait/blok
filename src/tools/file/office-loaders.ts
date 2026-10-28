import type { DeckView } from './pptx/viewer';
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

/** Dynamic-import the in-house pptx viewer (code-split out of the main bundle). */
export async function loadPptxRenderer(): Promise<{
  open: (buf: ArrayBuffer, container: HTMLElement, isCancelled?: () => boolean) => Promise<DeckView>;
}> {
  const mod = await import('./pptx/viewer');

  return { open: mod.openDeck };
}
