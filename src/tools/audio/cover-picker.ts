import { matchesMime } from '../../components/utils/mime-match';
import type { I18nInstance } from '../../components/utils/tools';
import { tr } from './i18n';
import { COVER_TYPES, COVER_MAX_SIZE } from './constants';

/** Validate a chosen cover file. Returns an error message, or null when valid. */
export function validateCoverFile(file: File, i18n?: I18nInstance): string | null {
  if (file.type && !matchesMime(file.type, [...COVER_TYPES])) {
    return tr(i18n, 'tools.audio.coverErrorType', 'Choose an image file');
  }
  if (file.size > COVER_MAX_SIZE) {
    return tr(i18n, 'tools.audio.coverErrorTooLarge', 'Image is too large');
  }
  return null;
}
