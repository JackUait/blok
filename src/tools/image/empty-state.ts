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
  /** MIME types to accept on file picker. */
  acceptTypes?: string[];
  /** Max file size in bytes — shown under the button when set. */
  maxSize?: number;
  /** Which insert sources to expose. Default `'both'`. */
  sources?: MediaSource;
  embedLabel?: string;
  embedPlaceholder?: string;
  submitLabel?: string;
  i18n?: I18nInstance;
}

export type EmptyStateElement = MediaEmptyStateElement;

export function renderEmptyState(opts: EmptyStateOptions): EmptyStateElement {
  const i18n = opts.i18n;
  return renderMediaEmptyState({
    acceptTypes: opts.acceptTypes ?? [...DEFAULT_MIME_TYPES],
    maxSize: opts.maxSize,
    sources: opts.sources,
    preview: 'image',
    onFile: opts.onFile,
    onUrl: opts.onUrl,
    labels: {
      add: tr(i18n, 'tools.image.emptyAddImage'),
      hint: tr(i18n, 'tools.image.emptyHint'),
      hintUpload: tr(i18n, 'tools.image.emptyHintUpload'),
      hintLink: tr(i18n, 'tools.image.emptyHintLink'),
      dropAnywhere: tr(i18n, 'tools.image.emptyDropAnywhere'),
      cancelLink: tr(i18n, 'notifier.cancel'),
      embed: opts.embedLabel ?? tr(i18n, 'tools.image.emptyLink'),
      chooseFile: tr(i18n, 'tools.image.emptyChooseFile'),
      dropToUpload: tr(i18n, 'tools.image.emptyDropToUpload'),
      urlPlaceholder: opts.embedPlaceholder ?? tr(i18n, 'tools.image.emptyUrlPlaceholder'),
      urlAria: tr(i18n, 'tools.image.emptyUrlAria'),
      submit: opts.submitLabel ?? tr(i18n, 'tools.image.emptyInsert'),
      maxSize: (size) =>
        i18n?.has('tools.image.emptyMaxSize')
          ? i18n.t('tools.image.emptyMaxSize', { size })
          : `max ${size}`,
    },
  });
}
