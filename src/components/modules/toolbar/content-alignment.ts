import { DATA_ATTR } from '../../constants';

/**
 * Horizontal alignment helpers for the toolbar.
 *
 * The toolbar's inner content wrapper (holding the plus button + drag handle)
 * must align with the block's visible content column. Two layouts exist:
 *
 *  1. Non-stretched block — `[data-blok-element-content]` is centered inside
 *     the holder via `mx-auto` + `max-w-blok-content`. The gap between holder
 *     left and content left IS the offset we want.
 *
 *  2. Stretched block (e.g. `database`) — the content element fills the holder
 *     (max-width removed), so the raw gap is 0. The tool may still re-center
 *     its visible content via internal CSS padding. In this case we fall back
 *     to the editor's canonical content-column width (`--max-width-content`)
 *     and center that inside the holder. Without this the toolbar snaps to
 *     the holder's far-left edge, far from the visible content.
 */

/**
 * Compute the horizontal offset between the holder's left edge and the block's
 * visible content column. See module doc for the two layout cases.
 * @param targetBlockHolder - Block holder element (has `data-blok-stretched` when stretched)
 * @param contentRect - bounding rect of the block's `[data-blok-element-content]`
 * @param wrapperRect - bounding rect of the toolbar wrapper (co-located with holder)
 */
export function computeVisualContentOffset(
  targetBlockHolder: HTMLElement,
  contentRect: DOMRect,
  wrapperRect: DOMRect | undefined
): number {
  if (wrapperRect === undefined) {
    return 0;
  }

  const stretched = targetBlockHolder.getAttribute(DATA_ATTR.stretched) === 'true';

  if (stretched) {
    const maxContent = readMaxContentWidth(targetBlockHolder);

    if (maxContent !== null && wrapperRect.width > maxContent) {
      return (wrapperRect.width - maxContent) / 2;
    }
  }

  return Math.max(0, contentRect.left - wrapperRect.left);
}

/**
 * Resolve the visible content width used to clamp the toolbar wrapper's
 * max-width. Stretched blocks still size their visible content to the
 * canonical content column (`--max-width-content`), so clamp to that
 * instead of the full holder width — otherwise the toolbar hover target
 * would span the whole viewport.
 * @param targetBlockHolder - Block holder element
 * @param contentRect - bounding rect of the block's `[data-blok-element-content]`
 * @param wrapperRect - bounding rect of the toolbar wrapper (co-located with holder)
 */
export function resolveVisualContentWidth(
  targetBlockHolder: HTMLElement,
  contentRect: DOMRect,
  wrapperRect: DOMRect | undefined
): number {
  const stretched = targetBlockHolder.getAttribute(DATA_ATTR.stretched) === 'true';

  if (stretched && wrapperRect !== undefined) {
    const maxContent = readMaxContentWidth(targetBlockHolder);

    if (maxContent !== null && wrapperRect.width > maxContent) {
      return maxContent;
    }
  }

  return contentRect.width;
}

/**
 * Read the `--max-width-content` CSS custom property off the given element
 * (inherited from `:root`/`@theme`). Returns `null` if the token is absent
 * or not a positive finite number.
 * @param element - element whose computed style supplies the CSS var
 */
function readMaxContentWidth(element: HTMLElement): number | null {
  const raw = getComputedStyle(element).getPropertyValue('--max-width-content').trim();
  const value = parseFloat(raw);

  return Number.isFinite(value) && value > 0 ? value : null;
}
