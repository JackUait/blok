import { IconPage } from '../../components/icons';
import { safeImageSrc } from '../../components/utils/sanitize-url';
import type { PageIcon } from './types';

/** The icon's content: an emoji, a safe image, or the glyph (the page glyph by default). */
export const pageIconNode = (icon: PageIcon | undefined, fallback: string = IconPage): Node => {
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
  glyph.innerHTML = fallback;

  return glyph.content;
};
