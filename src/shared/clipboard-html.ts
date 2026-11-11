import { safeHref, safeImageSrc } from './sanitize-url';

/**
 * Html a media block copies as for other apps: its link or image, then its
 * caption. Built with the DOM so text is escaped; core cleans it after.
 */

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const paragraph = (child: Node | string): HTMLParagraphElement => {
  const element = document.createElement('p');

  element.append(child);

  return element;
};

/**
 * The caption, when it is shown and not empty.
 * @param data - the block data with `caption` and `captionVisible`
 */
const captionParagraph = (data: { caption?: unknown; captionVisible?: unknown }): HTMLParagraphElement[] => {
  const caption = text(data.caption);

  return caption !== '' && data.captionVisible !== false ? [paragraph(caption)] : [];
};

const html = (elements: HTMLElement[]): string => elements.map((element) => element.outerHTML).join('');

/**
 * A link to `url` named by the first non-empty label, then the caption.
 * @param url - where the link goes
 * @param labels - link text candidates, in order; the url is the last resort
 * @param data - the block data holding the caption
 */
export const linkClipboardHtml = (
  url: unknown,
  labels: unknown[],
  data: { caption?: unknown; captionVisible?: unknown } = {}
): string | null => {
  const raw = text(url);

  if (raw === '') {
    return null;
  }

  const label = labels.map(text).find((candidate) => candidate !== '') ?? raw;
  const href = safeHref(raw);

  if (href === null) {
    return html([paragraph(label), ...captionParagraph(data)]);
  }

  const anchor = document.createElement('a');

  anchor.setAttribute('href', href);
  anchor.textContent = label;

  return html([paragraph(anchor), ...captionParagraph(data)]);
};

/**
 * An image, then the caption.
 * @param url - the image source
 * @param data - the block data holding the caption
 */
export const imageClipboardHtml = (url: unknown, data: { caption?: unknown; captionVisible?: unknown }): string | null => {
  const src = safeImageSrc(text(url));

  if (src === null || src === '') {
    return null;
  }

  const image = document.createElement('img');

  image.setAttribute('src', src);

  return html([paragraph(image), ...captionParagraph(data)]);
};
