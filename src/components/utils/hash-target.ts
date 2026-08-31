import { DATA_ATTR } from '../constants';

/**
 * What a URL fragment turned out to address.
 */
export interface HashTarget {
  /** The element to scroll to. */
  element: Element;
  /** The block that owns it, when there is one — `null` for a loose anchor. */
  blockId: string | null;
}

/**
 * Resolve a URL fragment to the element it addresses.
 *
 * Two namespaces answer to a fragment: a block id (`data-blok-id`, what "Copy
 * link to block" hands out) and a heading anchor (`HeaderData.anchor`, rendered
 * as the heading's own `id` — what in-document links in imported HTML point at,
 * e.g. a Google Docs table of contents linking `#h.2y1ok8y7pef0`). Block ids win:
 * they are Blok's own namespace, while an anchor is content and can be anything
 * the imported document happened to carry.
 *
 * The anchor lookup is scoped to `holder` so a fragment never matches another
 * editor on the page or an unrelated element of the host page. The block-id
 * lookup stays document-wide, as it has always been.
 *
 * @param hash - the decoded fragment, without the leading "#"
 * @param holder - this editor's holder element, when it exists yet
 * @returns the resolved target, or null when nothing answers to the fragment
 */
export function resolveHashTarget(hash: string, holder: Element | undefined | null): HashTarget | null {
  if (hash === '') {
    return null;
  }

  const byBlockId = document.querySelector(`[${DATA_ATTR.id}="${CSS.escape(hash)}"]`);

  if (byBlockId !== null) {
    return {
      element: byBlockId,
      blockId: hash,
    };
  }

  if (holder === undefined || holder === null) {
    return null;
  }

  const byAnchor = document.getElementById(hash);

  if (byAnchor === null || !holder.contains(byAnchor)) {
    return null;
  }

  return {
    element: byAnchor,
    blockId: byAnchor.closest(`[${DATA_ATTR.id}]`)?.getAttribute(DATA_ATTR.id) ?? null,
  };
}
