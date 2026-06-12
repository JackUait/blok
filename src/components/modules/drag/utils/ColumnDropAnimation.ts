/**
 * ColumnDropAnimation — FLIP-style motion for the moment a drag creates a new
 * column (wrapping a top-level block or adding a column beside an existing one).
 *
 * Three coordinated effects share one 200ms clock:
 * - the columns row interpolates from its pre-drop widths to the post-drop
 *   split (driven by a `flex-grow` transition, so text never scale-distorts),
 * - top-level blocks below the drop point glide to their new vertical slot
 *   (translateY FLIP),
 * - the drag preview "ghost" flies to the dropped block's final rect while
 *   fading out, instead of vanishing on mouseup.
 *
 * Every effect registers an instant-finish handle so a new drag can flush any
 * in-flight motion before it starts measuring rects.
 */

export const COLUMN_DROP_ANIMATION_MS = 200;
export const COLUMN_DROP_EASING = 'cubic-bezier(0.2, 0, 0, 1)';
/** Set on the columns row while the width interpolation runs; e2e hooks onto it. */
export const COLUMN_DROP_ANIMATING_ATTR = 'data-blok-column-drop-animating';

/** Transitionend can stall (tab hidden, interrupted property) — hard stop after this. */
const FALLBACK_TIMEOUT_MS = COLUMN_DROP_ANIMATION_MS + 150;

const prefersReducedMotion = (): boolean =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Below the project's mobile breakpoint columns stack vertically — width motion is meaningless. */
const isStackedLayout = (): boolean =>
  window.matchMedia?.('(max-width: 650px)').matches ?? false;

/** Instant-finish handles for every animation currently in flight. */
const activeFinishers = new Set<() => void>();

/**
 * Register a cleanup that runs exactly once — on the element's own
 * transitionend, on the fallback timer, or when a new drag flushes all
 * in-flight animations via {@link finishColumnDropAnimations}.
 */
const runOnce = (element: HTMLElement, cleanup: () => void): void => {
  const state = { done: false };

  const finish = (): void => {
    if (state.done) {
      return;
    }

    state.done = true;
    clearTimeout(timer);
    element.removeEventListener('transitionend', onTransitionEnd);
    activeFinishers.delete(finish);
    cleanup();
  };

  // Children may run their own transitions (e.g. embed alignment slides);
  // only the element's own transition may complete this animation.
  const onTransitionEnd = (event: Event): void => {
    if (event.target === element) {
      finish();
    }
  };

  const timer = setTimeout(finish, FALLBACK_TIMEOUT_MS);

  element.addEventListener('transitionend', onTransitionEnd);
  activeFinishers.add(finish);
};

/** Instantly complete every in-flight column-drop animation. Call before a new drag measures rects. */
export const finishColumnDropAnimations = (): void => {
  for (const finish of [...activeFinishers]) {
    finish();
  }
};

/**
 * Start grows proportional to the pre-drop pixel widths, normalized so they
 * sum to the same total as the final grows. The sum MUST be preserved: a
 * transition lerps each grow independently, and only a constant sum keeps the
 * width interpolation linear (otherwise all visible change bunches at the end).
 */
export const computeStartGrows = (startWidths: number[], finalGrows: number[]): number[] => {
  const widthSum = startWidths.reduce((sum, width) => sum + width, 0);
  const growSum = finalGrows.reduce((sum, grow) => sum + grow, 0);

  if (startWidths.length !== finalGrows.length || widthSum <= 0 || growSum <= 0) {
    return [...finalGrows];
  }

  return startWidths.map(width => (width / widthSum) * growSum);
};

/**
 * Interpolate the columns row from its captured pre-drop widths to the current
 * flex-grow split. The holders' inline `flex-grow` is the persisted source of
 * truth (Column.save reads it back), so it is pinned to the start value only
 * for one synchronous frame and lands back on the final value before the
 * transition begins.
 *
 * @param params.holders - every column holder in the row, in DOM order
 * @param params.startWidths - pre-drop pixel width per holder (0 for the new column)
 * @param params.newColumnHolder - freshly created column; additionally fades in
 */
export const animateColumnWidths = (params: {
  holders: HTMLElement[];
  startWidths: number[];
  newColumnHolder?: HTMLElement | null;
}): void => {
  const { holders, startWidths, newColumnHolder } = params;
  const widthSum = startWidths.reduce((sum, width) => sum + width, 0);

  if (
    holders.length !== startWidths.length ||
    holders.length === 0 ||
    widthSum <= 0 ||
    prefersReducedMotion() ||
    isStackedLayout()
  ) {
    return;
  }

  const finalGrows = holders.map(holder => Number(holder.style.flexGrow) || 1);
  const startGrows = computeStartGrows(startWidths, finalGrows);
  const container = holders[0].parentElement;

  // Alias to a local so the forEach mutations don't trip no-param-reassign.
  const newColumn = newColumnHolder;

  holders.forEach((holder, index) => {
    const el = holder;

    el.style.flexGrow = String(startGrows[index]);
  });

  if (newColumn) {
    newColumn.style.opacity = '0';
  }

  // Force a reflow so the pinned grows become the transition's start keyframe.
  void holders[0].offsetWidth;

  const transition = `flex-grow ${COLUMN_DROP_ANIMATION_MS}ms ${COLUMN_DROP_EASING}, opacity ${COLUMN_DROP_ANIMATION_MS}ms ${COLUMN_DROP_EASING}`;

  holders.forEach((holder, index) => {
    const el = holder;

    el.style.transition = transition;
    el.style.flexGrow = String(finalGrows[index]);
  });

  if (newColumn) {
    newColumn.style.opacity = '1';
  }

  container?.setAttribute(COLUMN_DROP_ANIMATING_ATTR, '');

  runOnce(holders[0], () => {
    holders.forEach((holder, index) => {
      const el = holder;

      el.style.removeProperty('transition');
      el.style.flexGrow = String(finalGrows[index]);
    });
    newColumn?.style.removeProperty('opacity');
    container?.removeAttribute(COLUMN_DROP_ANIMATING_ATTR);
  });
};

export interface SiblingTopCapture {
  element: HTMLElement;
  top: number;
}

/**
 * Capture the viewport tops of every `[data-blok-element]` sibling after
 * `after`, BEFORE the drop mutation. Feed the result to
 * {@link playSiblingShift} once the DOM has settled.
 */
export const captureSiblingTops = (after: Element): SiblingTopCapture[] => {
  const siblings = Array.from(after.parentElement?.children ?? []);
  const startIndex = siblings.indexOf(after);

  return siblings
    .slice(startIndex + 1)
    .filter(
      (sibling): sibling is HTMLElement =>
        sibling instanceof HTMLElement && sibling.hasAttribute('data-blok-element')
    )
    .map(element => ({ element, top: element.getBoundingClientRect().top }));
};

/**
 * translateY FLIP: every captured block that ended up at a different top is
 * pinned at its old position via transform, then released to glide into its
 * new slot. Pure transform — no layout work per frame.
 */
export const playSiblingShift = (captured: SiblingTopCapture[]): void => {
  if (prefersReducedMotion()) {
    return;
  }

  for (const { element, top } of captured) {
    if (!element.isConnected) {
      continue;
    }

    const deltaY = top - element.getBoundingClientRect().top;

    if (Math.abs(deltaY) < 1) {
      continue;
    }

    element.style.transform = `translateY(${deltaY}px)`;
    void element.offsetWidth;
    element.style.transition = `transform ${COLUMN_DROP_ANIMATION_MS}ms ${COLUMN_DROP_EASING}`;
    element.style.transform = '';

    runOnce(element, () => {
      element.style.removeProperty('transition');
      element.style.removeProperty('transform');
    });
  }
};

/**
 * Fly the fixed-position drag preview to the dropped block's final rect while
 * fading it out, then remove it. The caller must already own the element (it
 * is detached from DragPreview so cleanup() won't double-destroy it).
 */
export const settleDragPreview = (params: {
  preview: HTMLElement;
  targetRect: { left: number; top: number };
}): void => {
  const { preview, targetRect } = params;

  if (prefersReducedMotion()) {
    preview.remove();

    return;
  }

  preview.style.transition = `left ${COLUMN_DROP_ANIMATION_MS}ms ${COLUMN_DROP_EASING}, top ${COLUMN_DROP_ANIMATION_MS}ms ${COLUMN_DROP_EASING}, opacity ${COLUMN_DROP_ANIMATION_MS}ms ${COLUMN_DROP_EASING}`;
  preview.style.left = `${targetRect.left}px`;
  preview.style.top = `${targetRect.top}px`;
  preview.style.opacity = '0';

  runOnce(preview, () => preview.remove());
};
