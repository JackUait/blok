import { DATA_ATTR } from '../../components/constants/data-attributes';
import { getElementDirection } from '../../components/utils/direction';
import { TABS_ATTR } from './constants';

const DRAG_THRESHOLD_PX = 4;
// How long a block dragged over a pill rests there before the tab opens.
const DWELL_MS = 450;

export interface PillGesturesOptions {
  strip: HTMLElement;
  scroller: HTMLElement;
  /** Pills in strip order, read fresh on every gesture. */
  pills(): HTMLElement[];
  isReadOnly(): boolean;
  /** Move tab `id` before `before`, or to the end when undefined. */
  onReorder(id: string, before: string | undefined): void;
  /** Open a tab because a block is being dragged over its pill. */
  onDwell(id: string): void;
}

interface DragState {
  pill: HTMLElement;
  pointerId: number;
  startX: number;
  moved: boolean;
  /** Index the dragged pill would land at once dropped. */
  target: number;
  from: number;
  /** Inline-start offset of every pill at drag start, plus its width. */
  slots: { start: number; width: number }[];
}

const pillId = (pill: HTMLElement): string => pill.dataset.tabId ?? '';

/**
 * Pointer gestures on the tab strip:
 * - drag a pill sideways to reorder; the other pills slide out of its way;
 * - while a block is being dragged, rest on a pill to open that tab.
 * @param options - strip elements and callbacks
 * @returns a cleanup function
 */
export const attachPillGestures = (options: PillGesturesOptions): (() => void) => {
  const { strip, scroller } = options;
  const state: { drag: DragState | null; dwellId: string | null; dwellTimer: number | null; suppressClick: boolean } = {
    drag: null,
    dwellId: null,
    dwellTimer: null,
    suppressClick: false,
  };

  const inlineSign = (): number => (getElementDirection(scroller) === 'rtl' ? -1 : 1);

  const slotOf = (pill: HTMLElement): { start: number; width: number } => {
    const rect = pill.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    const start = inlineSign() === 1 ? rect.left - box.left : box.right - rect.right;

    return { start, width: rect.width };
  };

  const clearShifts = (): void => {
    options.pills().forEach((pill) => {
      pill.style.removeProperty('transform');
      pill.removeAttribute('data-shifting');
    });
    strip.removeAttribute('data-reordering');
  };

  const onPointerDown = (event: PointerEvent): void => {
    const pill = event.target instanceof Element ? event.target.closest<HTMLElement>(`[${TABS_ATTR.pill}]`) : null;

    if (pill === null || event.button !== 0 || options.isReadOnly() || pill.hasAttribute('data-renaming')) {
      return;
    }

    const pills = options.pills();
    const from = pills.indexOf(pill);

    state.drag = {
      pill,
      pointerId: event.pointerId,
      startX: event.clientX,
      moved: false,
      target: from,
      from,
      slots: pills.map(slotOf),
    };
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerCancel);
  };

  const onPointerMove = (event: PointerEvent): void => {
    const drag = state.drag;

    if (drag === null || event.pointerId !== drag.pointerId) {
      return;
    }

    const dx = event.clientX - drag.startX;

    if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) {
      return;
    }

    if (!drag.moved) {
      drag.moved = true;
      drag.pill.setAttribute('data-dragging', '');
      strip.setAttribute('data-reordering', '');
    }

    const sign = inlineSign();
    const self = drag.slots[drag.from];
    const first = drag.slots[0];
    const last = drag.slots[drag.slots.length - 1];
    // Keep the pill inside the strip, measured along the reading direction.
    const along = Math.min(Math.max(dx * sign, first.start - self.start), last.start + last.width - (self.start + self.width));
    const center = self.start + along + self.width / 2;

    // Final index = how many other pills now sit before the dragged one.
    // At the clamped ends the centers tie; a tie counts only past the start slot.
    drag.target = drag.slots.filter((slot, index) => {
      const other = slot.start + slot.width / 2;

      return index !== drag.from && (other < center || (other === center && index > drag.from));
    }).length;
    drag.pill.style.setProperty('transform', `translateX(${along * sign}px)`);

    const gap = drag.slots.length > 1 ? drag.slots[1].start - (drag.slots[0].start + drag.slots[0].width) : 0;

    options.pills().forEach((pill, index) => {
      if (pill === drag.pill) {
        return;
      }

      const movesBack = drag.from < index && index <= drag.target;
      const movesForward = drag.target <= index && index < drag.from;

      pill.setAttribute('data-shifting', '');

      if (!movesBack && !movesForward) {
        pill.style.removeProperty('transform');

        return;
      }

      const shift = (movesBack ? -1 : 1) * (self.width + gap);

      pill.style.setProperty('transform', `translateX(${shift * sign}px)`);
    });
  };

  const finishDrag = (commit: boolean): void => {
    const drag = state.drag;

    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', onPointerCancel);
    state.drag = null;

    if (drag === null || !drag.moved) {
      return;
    }

    drag.pill.removeAttribute('data-dragging');
    // The click a drag causes fires in the same task as pointerup. When the
    // pointer ends elsewhere no click comes, so the flag must not outlive the task.
    state.suppressClick = true;
    window.setTimeout(() => {
      state.suppressClick = false;
    }, 0);
    clearShifts();

    if (!commit || drag.target === drag.from) {
      return;
    }

    const before = options.pills().filter(pill => pill !== drag.pill)[drag.target];

    options.onReorder(pillId(drag.pill), before === undefined ? undefined : pillId(before));
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (state.drag?.pointerId === event.pointerId) {
      finishDrag(true);
    }
  };

  const onPointerCancel = (): void => finishDrag(false);

  // The pointerup of a drag fires a click on the pill: swallow that one.
  const onClickCapture = (event: MouseEvent): void => {
    if (state.suppressClick) {
      state.suppressClick = false;
      event.stopPropagation();
      event.preventDefault();
    }
  };

  const stopDwell = (): void => {
    if (state.dwellTimer !== null) {
      window.clearTimeout(state.dwellTimer);
    }
    strip.querySelector('[data-dwell]')?.removeAttribute('data-dwell');
    state.dwellTimer = null;
    state.dwellId = null;
  };

  // Blok's block drag is pointer-based and marks the editor wrapper.
  const onStripPointerMove = (event: PointerEvent): void => {
    const blockDrag = strip.closest(`[${DATA_ATTR.dragging}="true"]`) !== null;
    const pill = event.target instanceof Element ? event.target.closest<HTMLElement>(`[${TABS_ATTR.pill}]`) : null;

    if (!blockDrag || pill === null || pill.getAttribute('aria-selected') === 'true') {
      if (pill === null || !blockDrag || pillId(pill) !== state.dwellId) {
        stopDwell();
      }

      return;
    }

    const id = pillId(pill);

    if (id === state.dwellId) {
      return;
    }

    stopDwell();
    state.dwellId = id;
    pill.setAttribute('data-dwell', '');
    state.dwellTimer = window.setTimeout(() => {
      stopDwell();
      options.onDwell(id);
    }, DWELL_MS);
  };

  // A block released on a pill drops into that tab: open it so the block stays in view.
  const onStripPointerUp = (event: PointerEvent): void => {
    const pill = event.target instanceof Element ? event.target.closest<HTMLElement>(`[${TABS_ATTR.pill}]`) : null;

    if (pill === null || strip.closest(`[${DATA_ATTR.dragging}="true"]`) === null) {
      return;
    }

    stopDwell();
    options.onDwell(pillId(pill));
  };

  strip.addEventListener('pointerdown', onPointerDown);
  strip.addEventListener('click', onClickCapture, true);
  strip.addEventListener('pointermove', onStripPointerMove);
  strip.addEventListener('pointerleave', stopDwell);
  strip.addEventListener('pointerup', onStripPointerUp);

  return (): void => {
    finishDrag(false);
    stopDwell();
    strip.removeEventListener('pointerdown', onPointerDown);
    strip.removeEventListener('click', onClickCapture, true);
    strip.removeEventListener('pointermove', onStripPointerMove);
    strip.removeEventListener('pointerleave', stopDwell);
    strip.removeEventListener('pointerup', onStripPointerUp);
  };
};
