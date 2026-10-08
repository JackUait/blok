import { cleanPageField } from '../../../shared/page-title-icon';

import type * as Y from 'yjs';
import type { PageIcon } from '../../../../types/tools/page';

export { cleanPageField };

export type PageFieldKey = 'title' | 'icon';

export interface PageFields {
  title?: string;
  icon?: PageIcon;
}

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

/** Absent and malformed both read as "none", so a bad peer write never reaches the DOM. */
export const readPageFields = (map: Y.Map<unknown>): PageFields => {
  const title = map.get('title');
  const icon = map.get('icon');

  return {
    ...(typeof title === 'string' && title !== '' && { title }),
    ...(isPageIcon(icon) && { icon }),
  };
};

export const writePageField = (map: Y.Map<unknown>, key: PageFieldKey, value: string | PageIcon | null | undefined): void => {
  const clean = cleanPageField(value);

  if (clean === undefined || clean === null || clean === '') {
    map.delete(key);

    return;
  }
  map.set(key, clean);
};
