import type { PptxViewer } from '@aiden0z/pptx-renderer';
import type { Workbook as ExcelWorkbook } from 'exceljs';

/** Dynamic-import docx-preview's renderAsync (code-split out of the main bundle). */
export async function loadDocxRenderer(): Promise<
  (data: ArrayBuffer, bodyContainer: HTMLElement) => Promise<void>
> {
  const mod = await import('docx-preview');

  return (data, bodyContainer) =>
    mod.renderAsync(data, bodyContainer, undefined, {
      inWrapper: true,
      className: 'blok-docx',
    });
}

/** Dynamic-import ExcelJS's Workbook (code-split out of the main bundle). */
export async function loadXlsxRenderer(): Promise<new () => ExcelWorkbook> {
  const mod = await import('exceljs');

  return mod.Workbook;
}

/** Dynamic-import pptx-renderer's viewer + recommended zip limits. */
export async function loadPptxRenderer(): Promise<{
  open: (buf: ArrayBuffer, container: HTMLElement) => Promise<PptxViewer>;
}> {
  const mod = await import('@aiden0z/pptx-renderer');

  return {
    open: (buf, container) =>
      mod.PptxViewer.open(buf, container, {
        zipLimits: mod.RECOMMENDED_ZIP_LIMITS,
        pdfjs: false,
      }),
  };
}
