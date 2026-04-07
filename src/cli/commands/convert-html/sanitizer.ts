/**
 * Whitelist of allowed tags and their allowed attributes.
 * Tags not in this list are unwrapped (children preserved, tag removed).
 */
const ALLOWED: Record<string, Set<string> | true> = {
  // Inline
  B: true,
  STRONG: true,
  I: true,
  EM: true,
  A: new Set(['href']),
  S: true,
  U: true,
  CODE: true,
  MARK: new Set(['style']),
  BR: true,
  // Block
  P: true,
  H1: true, H2: true, H3: true, H4: true, H5: true, H6: true,
  UL: true,
  OL: true,
  LI: new Set(['aria-level']),
  TABLE: true, THEAD: true, TBODY: true, TR: true,
  TD: new Set(['style']),
  TH: new Set(['style']),
  BLOCKQUOTE: true,
  PRE: true,
  HR: true,
  ASIDE: new Set(['style']),
  DETAILS: true,
  SUMMARY: true,
  IMG: new Set(['src', 'style']),
};

/**
 * Sanitize DOM tree in place. Removes disallowed tags (unwrapping children)
 * and strips disallowed attributes from allowed tags.
 */
export function sanitize(wrapper: HTMLElement): void {
  sanitizeNode(wrapper);
}

/**
 * Unwrap a disallowed element: move its children before it, remove it,
 * and return any element children so they can be re-queued for processing.
 */
function unwrapElement(el: HTMLElement): ChildNode[] {
  const grandchildren = Array.from(el.childNodes);

  for (const gc of grandchildren) {
    el.before(gc);
  }
  el.remove();

  return grandchildren.filter((gc) => gc.nodeType === gc.ELEMENT_NODE);
}

/**
 * Strip attributes from an element that are not in the allowed set.
 * When `allowedAttrs` is `true`, all attributes are removed.
 */
function stripAttributes(el: HTMLElement, allowedAttrs: Set<string> | true): void {
  for (const attr of Array.from(el.attributes)) {
    if (allowedAttrs === true || !allowedAttrs.has(attr.name)) {
      el.removeAttribute(attr.name);
    }
  }
}

function sanitizeNode(node: Node): void {
  // Use a live-like approach: collect children, then process each.
  // When a child is unwrapped its grandchildren are inserted in place and
  // must themselves be processed as children of the same parent.
  const queue = Array.from(node.childNodes);

  for (const child of queue) {
    if (child.nodeType !== child.ELEMENT_NODE) {
      continue;
    }

    const el = child as HTMLElement;
    const allowedAttrs = ALLOWED[el.tagName];

    if (allowedAttrs === undefined) {
      // Unwrap disallowed tag and re-queue its element children.
      queue.push(...unwrapElement(el));
      continue;
    }

    stripAttributes(el, allowedAttrs);
    sanitizeNode(el);
  }
}
