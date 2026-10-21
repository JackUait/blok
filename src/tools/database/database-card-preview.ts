import type { DatabaseRow, PropertyValue } from './types';
import { coverImageOf, pageContentPreview } from './row-body';
import type { BodyBlock } from './row-body';
import type { ResolvedCardPreview } from './view-settings';
import { safeImageSrc } from '../../components/utils/sanitize-url';

/** The first URL in a files or url value. */
export const imageFromValue = (value: PropertyValue | undefined): string | undefined => {
  const first: unknown = Array.isArray(value) ? value[0] : value;
  const url = typeof first === 'object' && first !== null ? (first as { url?: unknown }).url : first;

  return typeof url === 'string' && url !== '' ? url : undefined;
};

/** Gallery cards and board cards keep their own attribute names. */
export type CardPreviewScope = 'gallery' | 'card';

function fillImage(box: HTMLElement, url: string | undefined, scope: CardPreviewScope): void {
  const src = url === undefined ? null : safeImageSrc(url);

  if (src === null) {
    box.setAttribute('data-empty', '');

    return;
  }

  const img = document.createElement('img');

  img.setAttribute(`data-blok-database-${scope}-image`, '');
  img.alt = '';
  img.loading = 'lazy';
  img.draggable = false;
  img.src = src;
  box.appendChild(img);
}

/**
 * What a card shows above its title: the page cover (the row's own cover,
 * else its first body image), the page content (its first image, else its
 * first lines), or a Files & media property's image.
 */
export const createCardPreview = (
  preview: ResolvedCardPreview,
  row: DatabaseRow,
  bodyOf: (rowId: string) => BodyBlock[],
  scope: CardPreviewScope
): HTMLElement | null => {
  if (preview.kind === 'none') {
    return null;
  }

  const fromProperty = preview.kind === 'property' ? imageFromValue(row.properties[preview.propertyId]) : undefined;

  // research/31 shot 51: a board card with no file has no preview area. A gallery keeps its empty cover (research/08).
  if (preview.kind === 'property' && fromProperty === undefined && scope === 'card') {
    return null;
  }

  const box = document.createElement('div');

  box.setAttribute(`data-blok-database-${scope}-preview`, '');
  box.setAttribute('data-preview', preview.kind);

  if (preview.kind === 'property') {
    fillImage(box, fromProperty, scope);

    return box;
  }

  const body = bodyOf(row.id);

  if (preview.kind === 'cover') {
    const ownCover = row.cover !== undefined && safeImageSrc(row.cover) !== null ? row.cover : undefined;

    fillImage(box, ownCover ?? coverImageOf(body), scope);

    return box;
  }

  const content = pageContentPreview(body);

  if (content.image !== undefined) {
    fillImage(box, content.image, scope);

    return box;
  }

  for (const line of content.lines) {
    const el = document.createElement('div');

    el.setAttribute(`data-blok-database-${scope}-preview-line`, line.level);
    el.textContent = line.text;
    box.appendChild(el);
  }
  if (content.lines.length === 0) {
    box.setAttribute('data-empty', '');
  }

  return box;
};
