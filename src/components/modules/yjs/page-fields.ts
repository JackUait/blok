import { cleanPageField } from '../../../shared/page-title-icon';

import type * as Y from 'yjs';
import type { PageCover, PageIcon } from '../../../../types/tools/page';

export { cleanPageField };

export type PageFieldKey = 'title' | 'icon' | 'cover';

export interface PageFields {
  title?: string;
  icon?: PageIcon;
  cover?: PageCover;
}

export type PageFieldValue = string | PageIcon | PageCover | null | undefined;

const isPageIcon = (value: unknown): value is PageIcon => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const icon = value as Record<string, unknown>;

  if (icon.type === 'emoji') {
    return typeof icon.value === 'string';
  }

  return icon.type === 'image' && typeof icon.url === 'string';
};

/** Position is a whole percent: fractions are where the three servers' number output can differ. */
export const isPageCover = (value: unknown): value is PageCover => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const cover = value as Record<string, unknown>;
  const position = cover.position;

  if (position !== undefined && !(Number.isInteger(position) && (position as number) >= 0 && (position as number) <= 100)) {
    return false;
  }
  if (cover.type === 'gallery') {
    return typeof cover.id === 'string' && cover.id !== '';
  }

  return cover.type === 'image' && typeof cover.url === 'string' && cover.url !== '';
};

/** Absent and malformed both read as "none", so a bad peer write never reaches the DOM. */
export const readPageFields = (map: Y.Map<unknown>): PageFields => {
  const title = map.get('title');
  const icon = map.get('icon');
  const cover = map.get('cover');

  return {
    ...(typeof title === 'string' && title !== '' && { title }),
    ...(isPageIcon(icon) && { icon }),
    ...(isPageCover(cover) && { cover }),
  };
};

export const writePageField = (map: Y.Map<unknown>, key: PageFieldKey, value: PageFieldValue): void => {
  const clean = cleanPageField(value);

  if (clean === undefined || clean === null || clean === '') {
    map.delete(key);

    return;
  }
  map.set(key, clean);
};
