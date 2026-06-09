import type { SanitizerConfig } from '../../../../types';

/**
 * Class applied to the mention anchor element.
 */
export const MENTION_CLASS = 'blok-mention';

/**
 * Class applied to the optional favicon image inside a mention.
 */
export const MENTION_FAVICON_CLASS = 'blok-mention__favicon';

/**
 * Class applied to the label span holding the mention's text.
 */
export const MENTION_LABEL_CLASS = 'blok-mention__label';

/**
 * Minimal input shape needed to build a mention chip.
 * A subset of `BookmarkMeta` — kept local to avoid coupling to the full shape.
 */
export interface MentionInput {
  url: string;
  title?: string;
  favicon?: string;
}

/**
 * Resolve the label text for a mention.
 * Prefers the title, then the URL hostname, then the raw URL string.
 * @param input - mention input (url + optional title)
 */
function resolveLabel(input: MentionInput): string {
  if (typeof input.title === 'string' && input.title.length > 0) {
    return input.title;
  }

  try {
    return new URL(input.url).hostname;
  } catch {
    return input.url;
  }
}

/**
 * Build an inline mention chip: an anchor with an optional favicon and a text label.
 *
 * The label text is set via `textContent` so any HTML in the title is treated as
 * literal text and never parsed — this prevents injection.
 * @param input - url, optional title and optional favicon
 * @returns the mention anchor element
 */
export function buildMentionElement(input: MentionInput): HTMLAnchorElement {
  const anchor = document.createElement('a');

  anchor.className = MENTION_CLASS;
  anchor.setAttribute('href', input.url);
  anchor.setAttribute('target', '_blank');
  anchor.setAttribute('rel', 'noreferrer nofollow');

  if (typeof input.favicon === 'string' && input.favicon.length > 0) {
    const favicon = document.createElement('img');

    favicon.className = MENTION_FAVICON_CLASS;
    favicon.src = input.favicon;
    favicon.alt = '';
    anchor.appendChild(favicon);
  }

  const label = document.createElement('span');

  label.className = MENTION_LABEL_CLASS;
  label.appendChild(document.createTextNode(resolveLabel(input)));
  anchor.appendChild(label);

  return anchor;
}

/**
 * Sanitizer config that lets the mention markup round-trip through save/restore.
 */
export const MENTION_SANITIZE_CONFIG: SanitizerConfig = {
  a: {
    href: true,
    class: true,
    target: true,
    rel: true,
  },
  img: {
    src: true,
    class: true,
    alt: true,
  },
  span: {
    class: true,
  },
};
