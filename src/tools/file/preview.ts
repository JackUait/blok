import type { FileData } from '../../../types/tools/file';
import { extToPrismLang } from './code-languages';

const MARKDOWN_EXTS = new Set(['md', 'markdown']);
const TEXT_EXTS = new Set(['txt', 'csv', 'log', 'ini', 'conf', 'env']);

/** Lower-cased extension from a path, with ?query and #hash stripped. '' when none. */
function extOf(value: string): string {
  const path = value.split('?')[0].split('#')[0];
  const dot = path.lastIndexOf('.');
  if (dot < 0 || dot === path.length - 1) {
    return '';
  }

  return path.slice(dot + 1).toLowerCase();
}

export type PreviewKind = 'pdf' | 'markdown' | 'code' | 'text';

/**
 * Classify a File block's file into a preview kind, or null when it can only
 * be downloaded. Resolution order: pdf → markdown → code → text → null.
 */
export function getPreviewKind(data: Partial<FileData>): PreviewKind | null {
  const source = data.fileName ?? data.url;
  const ext = source === undefined ? '' : extOf(source);

  if (data.mimeType === 'application/pdf' || ext === 'pdf') {
    return 'pdf';
  }

  if (data.mimeType === 'text/markdown' || MARKDOWN_EXTS.has(ext)) {
    return 'markdown';
  }

  if (extToPrismLang(ext) !== null) {
    return 'code';
  }

  if ((data.mimeType?.startsWith('text/') ?? false) || TEXT_EXTS.has(ext)) {
    return 'text';
  }

  return null;
}

/** Whether the File block's file can be rendered as an inline preview. */
export function isPreviewable(data: Partial<FileData>): boolean {
  return getPreviewKind(data) !== null;
}
