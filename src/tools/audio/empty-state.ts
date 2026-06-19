import { DEFAULT_MIME_TYPES } from './constants';
import { tr } from './i18n';
import {
  renderMediaEmptyState,
  type MediaEmptyStateElement,
} from '../../components/utils/media-empty-state';
import type { I18nInstance } from '../../components/utils/tools';

export interface EmptyStateOptions {
  onFile(file: File): void;
  onUrl(url: string): void;
  /** MIME types to accept on file picker + show in the formats hint. */
  acceptTypes?: string[];
  /** Max file size in bytes — surfaced in the formats hint when set. */
  maxSize?: number;
  i18n?: I18nInstance;
}

export type EmptyStateElement = MediaEmptyStateElement;

export function renderEmptyState(opts: EmptyStateOptions): EmptyStateElement {
  const i18n = opts.i18n;
  return renderMediaEmptyState({
    acceptTypes: opts.acceptTypes ?? [...DEFAULT_MIME_TYPES],
    maxSize: opts.maxSize,
    onFile: opts.onFile,
    onUrl: opts.onUrl,
    labels: {
      add: tr(i18n, 'tools.audio.emptyAddAudio', 'Add audio'),
      upload: tr(i18n, 'tools.audio.emptyUpload', 'Upload'),
      embed: tr(i18n, 'tools.audio.emptyLink', 'Link'),
      chooseFile: tr(i18n, 'tools.audio.emptyChooseFile', 'Choose file'),
      orDropHere: tr(i18n, 'tools.audio.emptyOrDropHere', 'or drop an audio file here'),
      dropToUpload: tr(i18n, 'tools.audio.emptyDropToUpload', 'Drop to upload'),
      urlPlaceholder: tr(i18n, 'tools.audio.emptyUrlPlaceholder', 'Paste an audio URL…'),
      urlAria: tr(i18n, 'tools.audio.emptyUrlAria', 'Audio URL'),
      submit: tr(i18n, 'tools.audio.emptyInsert', 'Insert'),
      sourceAria: tr(i18n, 'tools.audio.emptySourceAria', 'Audio source'),
      maxSize: (size) =>
        i18n?.has('tools.audio.emptyMaxSize')
          ? i18n.t('tools.audio.emptyMaxSize', { size })
          : `max ${size}`,
    },
  });
}
