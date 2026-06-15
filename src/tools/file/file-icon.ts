import {
  IconCode,
  IconFile,
  IconFileArchive,
  IconFileDoc,
  IconFilePdf,
  IconFileSheet,
  IconFileSlides,
  IconImage,
  IconMusic,
  IconVideo,
} from '../../components/icons';
import type { FileData } from '../../../types/tools/file';
import { extToPrismLang } from './code-languages';
import { extOf } from './preview';

/** Visual category a File block's file is bucketed into for its type icon. */
export type FileIconCategory =
  | 'pdf'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'archive'
  | 'audio'
  | 'video'
  | 'image'
  | 'code'
  | 'text'
  | 'generic';

const DOCUMENT_EXTS = new Set(['doc', 'docx', 'rtf', 'odt', 'pages']);
const SPREADSHEET_EXTS = new Set(['xls', 'xlsx', 'csv', 'tsv', 'ods', 'numbers']);
const PRESENTATION_EXTS = new Set(['ppt', 'pptx', 'odp', 'key']);
const ARCHIVE_EXTS = new Set(['zip', 'rar', '7z', 'gz', 'tgz', 'tar', 'bz2', 'xz']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'm4v']);
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'heic']);
const TEXT_EXTS = new Set(['txt', 'md', 'markdown', 'log', 'ini', 'conf', 'env']);

const CATEGORY_ICON: Record<FileIconCategory, string> = {
  pdf: IconFilePdf,
  document: IconFileDoc,
  spreadsheet: IconFileSheet,
  presentation: IconFileSlides,
  archive: IconFileArchive,
  audio: IconMusic,
  video: IconVideo,
  image: IconImage,
  code: IconCode,
  text: IconFile,
  generic: IconFile,
};

/**
 * Buckets a file into a visual category from its MIME type and extension.
 * Resolution runs most-specific-first; the filename extension wins over the
 * URL so a blob: URL with a known fileName still classifies.
 */
function classify(data: Partial<FileData>): FileIconCategory {
  const mime = data.mimeType ?? '';
  const source = data.fileName ?? data.url;
  const ext = source === undefined ? '' : extOf(source);

  if (mime === 'application/pdf' || ext === 'pdf') {
    return 'pdf';
  }
  if (ARCHIVE_EXTS.has(ext)) {
    return 'archive';
  }
  if (SPREADSHEET_EXTS.has(ext) || mime.includes('spreadsheet') || mime === 'application/vnd.ms-excel') {
    return 'spreadsheet';
  }
  if (PRESENTATION_EXTS.has(ext) || mime.includes('presentation') || mime === 'application/vnd.ms-powerpoint') {
    return 'presentation';
  }
  if (DOCUMENT_EXTS.has(ext) || mime.includes('wordprocessing') || mime === 'application/msword') {
    return 'document';
  }
  if (mime.startsWith('audio/') || AUDIO_EXTS.has(ext)) {
    return 'audio';
  }
  if (mime.startsWith('video/') || VIDEO_EXTS.has(ext)) {
    return 'video';
  }
  if (mime.startsWith('image/') || IMAGE_EXTS.has(ext)) {
    return 'image';
  }
  if (extToPrismLang(ext) !== null) {
    return 'code';
  }
  if (mime.startsWith('text/') || TEXT_EXTS.has(ext)) {
    return 'text';
  }

  return 'generic';
}

/** Picks the type icon and category for a File block's file. */
export function resolveFileIcon(data: Partial<FileData>): { category: FileIconCategory; icon: string } {
  const category = classify(data);

  return { category, icon: CATEGORY_ICON[category] };
}
