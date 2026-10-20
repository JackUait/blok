import { IconHelp } from '../../components/icons';
import { safeHref } from '../../components/utils/sanitize-url';

/**
 * A host help URL as Notion's "Learn about…" link: (?) icon, label, new tab.
 * Null without a URL or for an unsafe one, so the caller shows nothing.
 */
export const helpLink = (url: string | undefined, label: string, attribute: string): HTMLAnchorElement | null => {
  const href = url === undefined ? null : safeHref(url);

  if (href === null || href.trim() === '') {
    return null;
  }
  const link = document.createElement('a');
  const text = document.createElement('span');

  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute(attribute, '');
  link.innerHTML = IconHelp;
  text.textContent = label;
  link.appendChild(text);

  return link;
};
