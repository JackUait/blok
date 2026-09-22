import { prefersReducedMotion } from '../../../utils/reduced-motion';

/** Marks the fading copy of the toolbar. CSS keys the fade-out off it. */
export const TOOLBAR_GHOST_ATTR = 'data-blok-inline-toolbar-ghost';

/**
 * Longest the ghost may live. The CSS fade is 160ms; this is the backstop
 * when `animationend` never fires (tab hidden, animations off by a host).
 */
const GHOST_MAX_LIFETIME_MS = 400;

/**
 * Attributes that give an element an identity someone may look up: tests,
 * item lookups by name, the tooltip's "is a popover open" query, the top layer
 * (`popover` would hide the copy until shown), and the a11y tree. Styling hooks
 * (`data-blok-popover*`) stay, so the copy looks exactly like the toolbar.
 */
const IDENTITY_ATTRS = [
  'id',
  'role',
  'tabindex',
  'popover',
  'data-blok-testid',
  'data-blok-item-name',
  'data-blok-focused',
  'data-blok-popover-opened',
  'data-blok-top-layer',
];

const stripIdentity = (element: Element): void => {
  IDENTITY_ATTRS.forEach((name) => element.removeAttribute(name));
  Array.from(element.attributes)
    .filter((attr) => attr.name.startsWith('aria-'))
    .forEach((attr) => element.removeAttribute(attr.name));
};

/**
 * Leave a non-interactive copy of the toolbar where it stood, fading out, so
 * swapping the toolbar for a tool's own menu reads as one motion instead of a
 * cut. The copy is placed beside the toolbar wrapper so it shares its
 * positioning parent, and it removes itself once the fade ends.
 * @param popoverRoot - the toolbar popover's root element, still on screen
 * @param beside - the toolbar wrapper; the copy is inserted after it
 * @param originX - viewport x the copy shrinks toward (the clicked button)
 */
export const mountToolbarGhost = (popoverRoot: HTMLElement, beside: HTMLElement, originX: number | null): void => {
  const parent = beside.parentElement;

  if (prefersReducedMotion() || parent === null) {
    return;
  }

  const rect = popoverRoot.getBoundingClientRect();

  if (rect.width === 0 || rect.height === 0) {
    return;
  }

  const copy = popoverRoot.cloneNode(true);

  if (!(copy instanceof HTMLElement)) {
    return;
  }

  [copy, ...Array.from(copy.querySelectorAll('*'))].forEach(stripIdentity);

  const ghost = document.createElement('div');

  ghost.setAttribute(TOOLBAR_GHOST_ATTR, '');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.style.position = 'absolute';
  ghost.style.pointerEvents = 'none';
  // Stack with the toolbar; without it the next block paints over the copy.
  ghost.style.zIndex = getComputedStyle(beside).zIndex;
  ghost.append(copy);
  beside.after(ghost);

  // Measured after insertion: offsetParent only exists once it is in the tree.
  const origin = ghost.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 };

  ghost.style.left = `${rect.left - origin.left}px`;
  ghost.style.top = `${rect.top - origin.top}px`;

  if (originX !== null) {
    ghost.style.transformOrigin = `${originX - rect.left}px center`;
  }

  const remove = (): void => {
    ghost.remove();
  };

  ghost.addEventListener('animationend', remove, { once: true });
  window.setTimeout(remove, GHOST_MAX_LIFETIME_MS);
};
