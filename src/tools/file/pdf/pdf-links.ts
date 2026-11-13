import { safeHttpHref } from '../url';
import type { PdfAnnotationLike, PdfViewport } from './pdf-types';

/** Whether the url names its own scheme. safeHttpHref would resolve "/x" against the editor's page. */
function isAbsolute(raw: string): boolean {
  try {
    return new URL(raw).protocol !== '';
  } catch {
    return false;
  }
}

/** The rect as [left, top, right, bottom] in viewport px. */
function toViewport(rect: number[], viewport: PdfViewport): number[] {
  if (viewport.convertToViewportRectangle !== undefined) {
    return viewport.convertToViewportRectangle(rect);
  }
  const [x1, y1, x2, y2] = rect.map((value) => value * viewport.scale);

  return [x1, viewport.height - y1, x2, viewport.height - y2];
}

/** Percent, so the box keeps its place if the page box is resized before a redraw. */
function place(anchor: HTMLElement, rect: number[], viewport: PdfViewport): void {
  const [ax, ay, bx, by] = toViewport(rect, viewport);
  const percent = (value: number, total: number): string => `${(value / total) * 100}%`;
  Object.assign(anchor.style, {
    left: percent(Math.min(ax, bx), viewport.width),
    top: percent(Math.min(ay, by), viewport.height),
    width: percent(Math.abs(bx - ax), viewport.width),
    height: percent(Math.abs(by - ay), viewport.height),
  });
}

function externalLink(raw: string): HTMLAnchorElement | null {
  if (!isAbsolute(raw)) {
    return null;
  }
  const href = safeHttpHref(raw);
  if (href === null) {
    return null;
  }
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';

  return anchor;
}

/** A jump inside the document. No href: a "#" link would move the editor page. */
function internalLink(dest: unknown, goTo: (dest: unknown) => void): HTMLAnchorElement | null {
  if (dest === undefined || dest === null) {
    return null;
  }
  const anchor = document.createElement('a');
  anchor.setAttribute('role', 'link');
  anchor.tabIndex = 0;
  anchor.addEventListener('click', (event) => {
    event.preventDefault();
    goTo(dest);
  });
  anchor.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      goTo(dest);
    }
  });

  return anchor;
}

/**
 * Puts the page's links in `host`. Only http(s) urls become real links;
 * any other scheme in a PDF is dropped, so it never reaches the editor's page.
 */
export function renderPdfLinks(
  host: HTMLElement,
  annotations: PdfAnnotationLike[],
  viewport: PdfViewport,
  goTo: (dest: unknown) => void,
): void {
  annotations.forEach((annotation) => {
    if (annotation.subtype !== 'Link') {
      return;
    }
    const anchor = annotation.url !== undefined ? externalLink(annotation.url) : internalLink(annotation.dest, goTo);
    if (anchor === null) {
      return;
    }
    anchor.className = 'blok-file-preview-pdf-link';
    // The link's text lives in the text layer, not in the anchor. Without it
    // the link stays nameless: an English fallback would be untranslated.
    if (annotation.overlaidText !== undefined && annotation.overlaidText.trim() !== '') {
      anchor.setAttribute('aria-label', annotation.overlaidText.trim());
    }
    place(anchor, annotation.rect, viewport);
    host.appendChild(anchor);
  });
}
