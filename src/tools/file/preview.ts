import type { FileData } from '../../../types/tools/file';

/** Strips ?query and #hash, then reports whether the path ends with .pdf. */
function isPdfPath(value: string): boolean {
  const path = value.split('?')[0].split('#')[0];

  return path.toLowerCase().endsWith('.pdf');
}

/**
 * Whether the File block's file can be rendered as an inline preview.
 * Only PDFs are previewable for now: detected by an application/pdf MIME type
 * or a .pdf extension on the file name or url path.
 */
export function isPreviewable(data: Partial<FileData>): boolean {
  if (data.mimeType === 'application/pdf') {
    return true;
  }

  const source = data.fileName ?? data.url;

  return source !== undefined && isPdfPath(source);
}
