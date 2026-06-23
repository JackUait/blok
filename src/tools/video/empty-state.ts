import { DEFAULT_MIME_TYPES } from './constants';
import { tr } from './i18n';
import {
  renderMediaEmptyState,
  type MediaEmptyStateElement,
  type MediaSource,
} from '../../components/utils/media-empty-state';
import type { I18nInstance } from '../../components/utils/tools';

export interface EmptyStateOptions {
  onFile(file: File): void;
  onUrl(url: string): void;
  /** MIME types to accept on file picker + show in the formats hint. */
  acceptTypes?: string[];
  /** Max file size in bytes — surfaced in the formats hint when set. */
  maxSize?: number;
  /** Which insert sources to expose. Default `'both'`. */
  sources?: MediaSource;
  i18n?: I18nInstance;
}

export type EmptyStateElement = MediaEmptyStateElement;

export function renderEmptyState(opts: EmptyStateOptions): EmptyStateElement {
  const i18n = opts.i18n;
  return renderMediaEmptyState({
    acceptTypes: opts.acceptTypes ?? [...DEFAULT_MIME_TYPES],
    maxSize: opts.maxSize,
    sources: opts.sources,
    onFile: opts.onFile,
    onUrl: opts.onUrl,
    labels: {
      add: tr(i18n, 'tools.video.emptyAddVideo', 'Add a video'),
      upload: tr(i18n, 'tools.video.emptyUpload', 'Upload'),
      embed: tr(i18n, 'tools.video.emptyLink', 'Link'),
      chooseFile: tr(i18n, 'tools.video.emptyChooseFile', 'Choose file'),
      orDropHere: tr(i18n, 'tools.video.emptyOrDropHere', 'or drop a video here'),
      dropToUpload: tr(i18n, 'tools.video.emptyDropToUpload', 'Drop to upload'),
      urlPlaceholder: tr(i18n, 'tools.video.emptyUrlPlaceholder', 'Paste a video URL…'),
      urlAria: tr(i18n, 'tools.video.emptyUrlAria', 'Video URL'),
      submit: tr(i18n, 'tools.video.emptyInsert', 'Insert'),
      sourceAria: tr(i18n, 'tools.video.emptySourceAria', 'Video source'),
      maxSize: (size) =>
        i18n?.has('tools.video.emptyMaxSize')
          ? i18n.t('tools.video.emptyMaxSize', { size })
          : `max ${size}`,
    },
  });
}
