import type * as Y from 'yjs';
import type { PageIcon } from '../../../../types/tools/page';

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

const withoutNul = (text: string): string => text.replaceAll('\u0000', '');

/**
 * Drops U+0000 from the title and from every top-level string of the icon.
 * The server drops a title or icon that still holds one on export.
 */
export const cleanPageField = <T extends string | PageIcon | null | undefined>(value: T): T => {
  if (typeof value === 'string') {
    return withoutNul(value) as T;
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([name, field]) => [name, typeof field === 'string' ? withoutNul(field) : field])
  ) as T;
};

export const writePageField = (map: Y.Map<unknown>, key: PageFieldKey, value: string | PageIcon | null | undefined): void => {
  const clean = cleanPageField(value);

  if (clean === undefined || clean === null || clean === '') {
    map.delete(key);

    return;
  }
  map.set(key, clean);
};
