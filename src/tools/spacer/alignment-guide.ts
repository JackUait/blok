import { COLUMN_ATTR, COLUMNS_ATTR } from '../columns-shared';
import { DATA_ATTR } from '../../components/constants/data-attributes';

/**
 * How close (px) the dragged edge must get to a sibling block's bottom for the
 * guide to appear and the height to snap.
 */
export const SNAP_THRESHOLD = 6;

/**
 * Pick the sibling bottom closest to `edgeY`, or null when none is within
 * SNAP_THRESHOLD.
 *
 * @param edgeY - viewport y of the edge being dragged
 * @param targets - candidate viewport y values to snap to
 */
export const findSnapTarget = (edgeY: number, targets: number[]): number | null => {
  const inRange = targets.filter((target) => Math.abs(target - edgeY) <= SNAP_THRESHOLD);

  if (inRange.length === 0) {
    return null;
  }

  return inRange.reduce((closest, target) =>
    Math.abs(target - edgeY) < Math.abs(closest - edgeY) ? target : closest
  );
};

/**
 * Tools whose block renders nothing at all when it holds no text. A textless
 * divider/image/spacer still has a visible end worth aligning to; an empty
 * paragraph does not.
 */
const TEXT_COMPONENTS = new Set(['paragraph', 'header', 'quote']);

/**
 * Whether a block holder is a text block with no text in it — the trailing
 * empty paragraph an Enter press leaves behind. Its bottom is an invisible
 * boundary, so offering it as an alignment target is noise.
 *
 * @param holder - a block holder element
 */
const isEmptyTextBlock = (holder: HTMLElement): boolean => {
  const component = holder.getAttribute('data-blok-component');

  if (component === null || !TEXT_COMPONENTS.has(component)) {
    return false;
  }

  // Browsers park a <br> inside an empty contenteditable; textContent ignores it.
  return (holder.textContent ?? '').trim() === '';
};

/**
 * Viewport bottoms of every block sitting in the spacer's SIBLING columns —
 * the ends the user is trying to line their content up with. Two exclusions:
 * blocks in the spacer's own column (snapping to those would be snapping to
 * its own neighbours, which carries no alignment meaning), and empty text
 * blocks (no visible end to align with).
 *
 * @param spacerElement - the rendered spacer wrapper
 */
export const collectSiblingBlockBottoms = (spacerElement: HTMLElement): number[] => {
  const ownColumn = spacerElement.closest<HTMLElement>(`[${COLUMN_ATTR}]`);
  const columnList = ownColumn?.closest<HTMLElement>(`[${COLUMNS_ATTR}]`);

  if (ownColumn === null || columnList === null || columnList === undefined) {
    return [];
  }

  const siblingColumns = Array.from(columnList.querySelectorAll<HTMLElement>(`[${COLUMN_ATTR}]`))
    .filter((column) => column !== ownColumn);

  return siblingColumns.flatMap((column) =>
    Array.from(column.querySelectorAll<HTMLElement>(`[${DATA_ATTR.element}]`))
      .filter((holder) => !isEmptyTextBlock(holder))
      .map((holder) => holder.getBoundingClientRect().bottom)
  );
};

/**
 * Accent used when the editor scope resolves no --blok-color-accent (e.g. the
 * stylesheet has not loaded). Matches the light-theme token.
 */
const FALLBACK_ACCENT = '#2383e2';

/**
 * Above block content; a literal because the guide is parented to document.body,
 * outside the editor scope that defines --blok-z-* (see the color note below).
 */
const GUIDE_Z_INDEX = '10';

/**
 * The horizontal guideline drawn across the column list while a dragged spacer
 * edge is aligned with a sibling block's bottom. Lives on document.body (fixed
 * positioning) so it can span columns without being clipped by any of them, and
 * so it never mutates the observed block subtree.
 */
export class AlignmentGuide {
  /**
   * The rendered line; null while hidden
   */
  private line: HTMLElement | null = null;

  /**
   * Draw (or move) the guideline at the given viewport y, spanning the width
   * of the column list.
   *
   * @param y - viewport y of the alignment
   * @param bounds - rect of the column list the guide spans
   * @param scope - element inside the editor, used to resolve themed tokens
   */
  public show(y: number, bounds: DOMRect, scope: HTMLElement): void {
    if (this.line === null) {
      const line = document.createElement('div');

      line.setAttribute('data-blok-spacer-guide', '');
      line.setAttribute('aria-hidden', 'true');
      line.style.position = 'fixed';
      line.style.height = '2px';
      line.style.borderRadius = '1px';
      line.style.pointerEvents = 'none';
      line.style.zIndex = GUIDE_Z_INDEX;

      document.body.appendChild(line);
      this.line = line;
    }

    // The editor's --blok-* custom properties are scoped to its root, and the
    // guide is parented to <body> — a var() reference here would resolve to
    // nothing and paint an invisible line. Resolve the theme's accent against
    // the editor scope and set it as a literal.
    const accent = window.getComputedStyle(scope).getPropertyValue('--blok-color-accent').trim();

    this.line.style.backgroundColor = accent === '' ? FALLBACK_ACCENT : accent;

    // Center the 2px line on the alignment y.
    this.line.style.top = `${Math.round(y) - 1}px`;
    this.line.style.left = `${Math.round(bounds.left)}px`;
    this.line.style.width = `${Math.round(bounds.width)}px`;
  }

  /**
   * Remove the guideline
   */
  public hide(): void {
    this.line?.remove();
    this.line = null;
  }
}
