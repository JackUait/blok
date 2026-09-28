import type { I18n } from '../../../types/api';
import { twMerge } from '../../components/utils/tw';
import type { CellPlacement } from './types';

interface PlacementPickerOptions {
  i18n: I18n;
  currentPlacement: CellPlacement | undefined;
  onPlacementSelect: (placement: CellPlacement) => void;
}

interface PlacementPickerResult {
  element: HTMLDivElement;
}

type Side = 'left' | 'center' | 'right';

/**
 * Only the middle row is offered. Cells saved with any other placement still
 * render as saved; the picker checks the option on the same side.
 */
const OPTIONS: { side: Side; placement: CellPlacement; key: string }[] = [
  { side: 'left', placement: 'middle-left', key: 'tools.table.placementMiddleLeft' },
  { side: 'center', placement: 'middle-center', key: 'tools.table.placementMiddleCenter' },
  { side: 'right', placement: 'middle-right', key: 'tools.table.placementMiddleRight' },
];

const LINE_ALIGN: Record<Side, string> = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
};

/** Text lines drawn inside each option, in px. The glyph is as wide as the first. */
const GLYPH_WIDTH = 22;
const LINE_WIDTHS = [22, 14, 18];

/** Where a line of this width starts when aligned to this side. */
const offsetOf = (side: Side, width: number): number => {
  if (side === 'left') {
    return 0;
  }

  return side === 'center' ? (GLYPH_WIDTH - width) / 2 : GLYPH_WIDTH - width;
};

const SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

/**
 * The picked option's lines spring over from the old alignment, like text reflowing.
 * Skipped without the Web Animations API or when reduced motion is asked for.
 */
const reflowLines = (glyph: HTMLElement, from: Side, to: Side): void => {
  const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduced) {
    return;
  }

  Array.from(glyph.children).forEach((line, index) => {
    if (!(line instanceof HTMLElement) || typeof line.animate !== 'function') {
      return;
    }

    const width = LINE_WIDTHS[index];

    line.animate(
      [{ transform: `translateX(${offsetOf(from, width) - offsetOf(to, width)}px)` }, { transform: 'translateX(0)' }],
      { duration: 420, delay: index * 40, easing: SPRING, fill: 'backwards' }
    );
  });
};

const GROUP_CLASSES = [
  'relative',
  'grid',
  'grid-cols-3',
  'p-[3px]',
  'rounded-[10px]',
  'shadow-[inset_0_0_0_1px_var(--blok-item-hover-bg)]',
];

/**
 * The selection is a neutral surface that springs between options — never blue.
 * Its width matches one grid column, so translateX(n * 100%) lands on option n.
 */
const THUMB_CLASSES = [
  'absolute',
  'top-[3px]',
  'bottom-[3px]',
  'left-[3px]',
  'w-[calc((100%-6px)/3)]',
  'rounded-[7px]',
  'bg-icon-active-bg',
  'pointer-events-none',
  'transition-transform',
  'duration-[320ms]',
  '[transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)]',
  'motion-reduce:transition-none',
];

const OPTION_CLASSES = [
  'relative',
  'flex',
  'items-center',
  'justify-center',
  'h-10',
  'rounded-[7px]',
  'border-none',
  'bg-transparent',
  'text-text-primary',
  'cursor-pointer',
  'select-none',
  'outline-hidden',
  'transition-transform',
  'duration-150',
  'active:scale-[0.94]',
  'motion-reduce:transition-none',
  'can-hover:hover:bg-item-hover-bg',
  // A focus stop in the popover's Flipper needs the same keyboard highlight as other items.
  'data-[blok-focused="true"]:bg-item-focus-bg',
];

const GLYPH_CLASSES = [
  'flex',
  'flex-col',
  'gap-[3px]',
  'pointer-events-none',
];

const LINE_CLASSES = [
  'h-[2px]',
  'rounded-full',
  'bg-current',
];

const LABEL_CLASSES = [
  'mt-1.5',
  'text-center',
  'text-xs',
  'text-text-secondary',
  'select-none',
];

const sideOf = (placement: CellPlacement | undefined): Side => {
  const side = (placement ?? 'top-left').split('-')[1];

  return side === 'center' || side === 'right' ? side : 'left';
};

export const createCellPlacementPicker = (options: PlacementPickerOptions): PlacementPickerResult => {
  const wrapper = document.createElement('div');

  wrapper.className = 'p-1.5 w-[168px]';

  const group = document.createElement('div');

  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', options.i18n.t('tools.table.placement'));
  group.className = twMerge(GROUP_CLASSES);

  const thumb = document.createElement('div');

  thumb.setAttribute('data-blok-placement-thumb', '');
  thumb.setAttribute('aria-hidden', 'true');
  thumb.className = twMerge(THUMB_CLASSES);
  group.appendChild(thumb);

  const label = document.createElement('div');

  label.setAttribute('data-blok-placement-label', '');
  // The radios already carry their names for assistive tech.
  label.setAttribute('aria-hidden', 'true');
  label.className = twMerge(LABEL_CLASSES);

  const buttons: HTMLButtonElement[] = [];
  const state = { index: OPTIONS.findIndex(option => option.side === sideOf(options.currentPlacement)) };

  const paint = (): void => {
    buttons.forEach((button, index) => {
      button.setAttribute('aria-checked', String(index === state.index));
    });
    thumb.style.transform = `translateX(${state.index * 100}%)`;
    label.textContent = options.i18n.t(OPTIONS[state.index].key);
  };

  OPTIONS.forEach((option, index) => {
    const button = document.createElement('button');

    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.setAttribute('data-placement', option.placement);
    button.setAttribute('aria-label', options.i18n.t(option.key));
    button.className = twMerge(OPTION_CLASSES);

    const glyph = document.createElement('div');

    glyph.setAttribute('data-blok-placement-glyph', '');
    glyph.className = twMerge(GLYPH_CLASSES);
    glyph.style.width = `${GLYPH_WIDTH}px`;
    glyph.style.alignItems = LINE_ALIGN[option.side];

    for (const width of LINE_WIDTHS) {
      const line = document.createElement('div');

      line.className = twMerge(LINE_CLASSES);
      line.style.width = `${width}px`;
      glyph.appendChild(line);
    }

    button.appendChild(glyph);

    button.addEventListener('pointerenter', () => {
      label.textContent = options.i18n.t(option.key);
    });
    button.addEventListener('pointerleave', () => {
      label.textContent = options.i18n.t(OPTIONS[state.index].key);
    });
    button.addEventListener('click', () => {
      const previous = OPTIONS[state.index].side;

      state.index = index;
      paint();
      if (previous !== option.side) {
        reflowLines(glyph, previous, option.side);
      }
      options.onPlacementSelect(option.placement);
    });

    buttons.push(button);
    group.appendChild(button);
  });

  paint();

  wrapper.appendChild(group);
  wrapper.appendChild(label);

  return { element: wrapper };
};
