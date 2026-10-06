import { IconPage } from '../../components/icons';
import { safeImageSrc } from '../../components/utils/sanitize-url';
import type { PageIcon } from './types';

/** The icon's content: an emoji, a safe image, or the page glyph. */
export const pageIconNode = (icon: PageIcon | undefined): Node => {
  if (icon?.type === 'emoji') {
    return document.createTextNode(icon.value);
  }

  const src = icon?.type === 'image' ? safeImageSrc(icon.url) : null;

  if (src !== null) {
    const img = document.createElement('img');

    img.src = src;
    img.alt = '';

    return img;
  }

  const glyph = document.createElement('template');

  // A trusted constant from the icon module, not user input.
  glyph.innerHTML = IconPage;

  return glyph.content;
};
