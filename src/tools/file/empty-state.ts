import {
  renderMediaEmptyState,
  type MediaEmptyStateElement,
} from '../../components/utils/media-empty-state';
import type { I18nInstance } from '../../components/utils/tools';

export type EmptyStateElement = MediaEmptyStateElement;

export interface EmptyStateOptions {
  /** MIME types to accept on the file picker + show in the formats hint. */
  acceptTypes: string[];
  /** Max file size in bytes — surfaced in the formats hint when set. */
  maxSize?: number;
  i18n: I18nInstance;
  onFile(file: File): void;
  onUrl(url: string): void;
}

export function renderEmptyState(opts: EmptyStateOptions): EmptyStateElement {
  const { i18n } = opts;
  return renderMediaEmptyState({
    acceptTypes: opts.acceptTypes,
    maxSize: opts.maxSize,
    onFile: opts.onFile,
    onUrl: opts.onUrl,
    labels: {
      add: i18n.t('tools.file.emptyAddFile'),
      upload: i18n.t('tools.file.emptyUpload'),
      embed: i18n.t('tools.file.emptyLink'),
      chooseFile: i18n.t('tools.file.emptyChooseFile'),
      orDropHere: i18n.t('tools.file.emptyDropHint'),
      dropToUpload: i18n.t('tools.file.emptyDropToUpload'),
      urlPlaceholder: i18n.t('tools.file.emptyUrlPlaceholder'),
      urlAria: i18n.t('tools.file.emptyUrlAria'),
      submit: i18n.t('tools.file.emptyInsert'),
      sourceAria: i18n.t('tools.file.emptySourceAria'),
    },
  });
}
