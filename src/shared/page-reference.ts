import type { TagConfig } from '../../types/configs/sanitizer-config';

export const PAGE_REFERENCE_ATTR = 'data-blok-page-id';
export const PAGE_REFERENCE_FALLBACK = 'Page';

export const protectPageReferenceAnchor = (
  ordinaryRule: TagConfig | ((node: Element) => TagConfig)
): ((node: Element) => TagConfig) => (node) => {
  if (node.getAttribute(PAGE_REFERENCE_ATTR)) {
    return preservePageReferenceAnchor(node);
  }

  return typeof ordinaryRule === 'function' ? ordinaryRule(node) : ordinaryRule;
};

export const preservePageReferenceAnchor = (node: Element): TagConfig => {
  const pageId = node.getAttribute(PAGE_REFERENCE_ATTR);

  if (pageId !== null && pageId !== '') {
    // eslint-disable-next-line no-param-reassign -- the sanitizer passes a detached node
    node.textContent = PAGE_REFERENCE_FALLBACK;

    return { [PAGE_REFERENCE_ATTR]: true };
  }

  return { href: true, target: true, rel: true };
};
