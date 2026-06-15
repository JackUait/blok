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
  uploadLabel?: string;
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
    onFile: opts.onFile,
    onUrl: opts.onUrl,
    labels: {
      add: tr(i18n, 'tools.image.emptyAddImage'),
      upload: opts.uploadLabel ?? tr(i18n, 'tools.image.emptyUpload'),
      embed: opts.embedLabel ?? tr(i18n, 'tools.image.emptyLink'),
      chooseFile: tr(i18n, 'tools.image.emptyChooseFile'),
      orDropHere: tr(i18n, 'tools.image.emptyOrDropHere'),
      dropToUpload: tr(i18n, 'tools.image.emptyDropToUpload'),
      urlPlaceholder: opts.embedPlaceholder ?? tr(i18n, 'tools.image.emptyUrlPlaceholder'),
      urlAria: tr(i18n, 'tools.image.emptyUrlAria'),
      submit: opts.submitLabel ?? tr(i18n, 'tools.image.emptyInsert'),
      sourceAria: tr(i18n, 'tools.image.emptySourceAria'),
      maxSize: (size) =>
        i18n?.has('tools.image.emptyMaxSize')
          ? i18n.t('tools.image.emptyMaxSize', { size })
          : `max ${size}`,
    },
  });
}
