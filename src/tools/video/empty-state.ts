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
  i18n?: I18nInstance;
}

export type EmptyStateElement = MediaEmptyStateElement;

export function renderEmptyState(opts: EmptyStateOptions): EmptyStateElement {
  const i18n = opts.i18n;
  return renderMediaEmptyState({
    acceptTypes: opts.acceptTypes ?? [...DEFAULT_MIME_TYPES],
    maxSize: opts.maxSize,
    sources: opts.sources,
    preview: 'video',
    onFile: opts.onFile,
    onUrl: opts.onUrl,
    labels: {
      add: tr(i18n, 'tools.video.emptyAddVideo', 'Add a video'),
      hint: tr(i18n, 'tools.video.emptyHint', 'Drag a video here, choose one from your device, or paste a link.'),
      hintUpload: tr(i18n, 'tools.video.emptyHintUpload', 'Drag a video here or choose one from your device.'),
      hintLink: tr(i18n, 'tools.image.emptyHintLink', 'Paste a link to it below.'),
      dropAnywhere: tr(i18n, 'tools.image.emptyDropAnywhere', 'Let go anywhere in this block.'),
      cancelLink: tr(i18n, 'notifier.cancel', 'Cancel'),
      embed: tr(i18n, 'tools.video.emptyLink', 'From a link'),
      chooseFile: tr(i18n, 'tools.video.emptyChooseFile', 'Choose a video'),
      dropToUpload: tr(i18n, 'tools.video.emptyDropToUpload', 'Drop to add'),
      urlPlaceholder: tr(i18n, 'tools.video.emptyUrlPlaceholder', 'Paste a video link…'),
      urlAria: tr(i18n, 'tools.video.emptyUrlAria', 'Video URL'),
      submit: tr(i18n, 'tools.video.emptyInsert', 'Add'),
      maxSize: (size) =>
        i18n?.has('tools.video.emptyMaxSize')
          ? i18n.t('tools.video.emptyMaxSize', { size })
          : `max ${size}`,
    },
  });
}
