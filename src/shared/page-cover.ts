/**
 * The page cover's shape and Blok's built-in gallery.
 *
 * PURITY: no runtime imports — the server runtime bundles the agent planner, which uses these.
 */
import type { PageCover } from '../../types/tools/page';

/**
 * Ids of the built-in gallery covers, in picker order. Each is a CSS fill in
 * page-title.css, keyed on `data-blok-page-cover-id`. The servers accept any
 * id, so a page made by a newer Blok still loads; an id not listed here draws
 * a plain fill.
 */
export const COVER_GALLERY = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'gray'] as const;

export type CoverGalleryId = typeof COVER_GALLERY[number];

export const isGalleryCoverId = (id: string): id is CoverGalleryId => (COVER_GALLERY as readonly string[]).includes(id);

/** Position is a whole percent: fractions are where the three servers' number output can differ. */
export const isPageCover = (value: unknown): value is PageCover => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const cover = value as Record<string, unknown>;
  const position = cover.position;

  if (position !== undefined && !(typeof position === 'number' && Number.isInteger(position) && position >= 0 && position <= 100)) {
    return false;
  }
  if (cover.type === 'gallery') {
    return typeof cover.id === 'string' && cover.id !== '';
  }

  return cover.type === 'image' && typeof cover.url === 'string' && cover.url !== '';
};
