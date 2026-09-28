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

const GLYPH_ALIGN: Record<Side, string> = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
};

/** Text lines of the small option glyphs, in px. */
const GLYPH_LINES = [22, 14, 18];

/**
 * Text lines of the preview card, in px, laid out in a PREVIEW_TEXT_WIDTH box:
 * the 184px card minus its 14px padding on each side.
 */
const PREVIEW_TEXT_WIDTH = 156;
const PREVIEW_LINES = [104, 64, 88];

/** How far a line of this width sits from the left edge when aligned to this side. */
const offsetOf = (side: Side, width: number): number => {
  if (side === 'left') {
    return 0;
  }

  return side === 'center' ? (PREVIEW_TEXT_WIDTH - width) / 2 : PREVIEW_TEXT_WIDTH - width;
};

/**
 * Same motion as the cell glide: accelerates from rest, then brakes hard,
 * without overshoot. Longer or springy motion reads as lag after the click.
 */
const EASE_IN_OUT = '[transition-timing-function:cubic-bezier(0.7,0,0.2,1)]';

/** Same width, radius and neutral surface as the options track below it. */
const PREVIEW_CLASSES = [
  'relative',
  'h-[68px]',
  'mb-1.5',
  'rounded-[10px]',
  'bg-item-hover-bg',
  'overflow-hidden',
];

const TEXT_BOX_CLASSES = [
  'absolute',
  'inset-x-[14px]',
  'top-1/2',
  '-translate-y-1/2',
  'flex',
  'flex-col',
  'gap-[6px]',
];

const PREVIEW_LINE_CLASSES = [
  'h-1',
  'rounded-full',
  'bg-current',
  'transition-transform',
  'duration-[240ms]',
  EASE_IN_OUT,
  'motion-reduce:transition-none',
];

const GROUP_CLASSES = [
  'relative',
  'grid',
  'grid-cols-3',
  'p-[3px]',
  'rounded-[10px]',
  'shadow-[inset_0_0_0_1px_var(--blok-border-secondary)]',
];

/**
 * The selection is a neutral surface that slides between options — never blue.
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
  'duration-[240ms]',
  EASE_IN_OUT,
  'motion-reduce:transition-none',
];

const OPTION_CLASSES = [
  'relative',
  'flex',
  'items-center',
  'justify-center',
  'h-8',
  'rounded-[7px]',
  'border-none',
  'bg-transparent',
  'text-text-primary',
  'cursor-pointer',
  'select-none',
  'outline-hidden',
  'transition-transform',
  'duration-150',
  'active:scale-[0.92]',
  'motion-reduce:transition-none',
  // A focus stop in the popover's Flipper needs the same keyboard highlight as other items.
  'data-[blok-focused="true"]:bg-item-focus-bg',
];

const GLYPH_CLASSES = [
  'flex',
  'flex-col',
  'gap-[2.5px]',
  'pointer-events-none',
];

const GLYPH_LINE_CLASSES = [
  'h-[1.5px]',
  'rounded-full',
  'bg-current',
];

const sideOf = (placement: CellPlacement | undefined): Side => {
  const side = (placement ?? 'top-left').split('-')[1];

  return side === 'center' || side === 'right' ? side : 'left';
};

const div = (classes: string[]): HTMLDivElement => {
  const element = document.createElement('div');

  element.className = twMerge(classes);

  return element;
};

export const createCellPlacementPicker = (options: PlacementPickerOptions): PlacementPickerResult => {
  const wrapper = document.createElement('div');

  wrapper.className = 'p-1.5 w-[196px]';

  const preview = div(PREVIEW_CLASSES);

  preview.setAttribute('data-blok-placement-preview', '');
  // Decorative: the radios carry the names and the state.
  preview.setAttribute('aria-hidden', 'true');

  const textBox = div(TEXT_BOX_CLASSES);

  const previewLines = PREVIEW_LINES.map((width, index) => {
    const line = div(PREVIEW_LINE_CLASSES);

    line.setAttribute('data-blok-placement-preview-line', '');
    line.style.width = `${width}px`;
    // A heading-like first line over body text.
    line.classList.add(index === 0 ? 'text-text-primary' : 'text-text-secondary');
    textBox.appendChild(line);

    return line;
  });

  preview.appendChild(textBox);

  const group = div(GROUP_CLASSES);

  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', options.i18n.t('tools.table.placement'));

  const thumb = div(THUMB_CLASSES);

  thumb.setAttribute('data-blok-placement-thumb', '');
  thumb.setAttribute('aria-hidden', 'true');
  group.appendChild(thumb);

  const buttons: HTMLButtonElement[] = [];
  const state = { index: OPTIONS.findIndex(option => option.side === sideOf(options.currentPlacement)) };

  /** Shows one option in the preview without committing it. */
  const show = (index: number): void => {
    const { side } = OPTIONS[index];

    for (const [lineIndex, line] of previewLines.entries()) {
      line.style.transform = `translateX(${offsetOf(side, PREVIEW_LINES[lineIndex])}px)`;
    }
  };

  const paint = (): void => {
    buttons.forEach((button, index) => {
      button.setAttribute('aria-checked', String(index === state.index));
    });
    thumb.style.transform = `translateX(${state.index * 100}%)`;
    show(state.index);
  };

  OPTIONS.forEach((option, index) => {
    const button = document.createElement('button');

    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.setAttribute('data-placement', option.placement);
    button.setAttribute('aria-label', options.i18n.t(option.key));
    button.className = twMerge(OPTION_CLASSES);

    const glyph = div(GLYPH_CLASSES);

    glyph.setAttribute('data-blok-placement-glyph', '');
    glyph.style.width = `${GLYPH_LINES[0]}px`;
    glyph.style.alignItems = GLYPH_ALIGN[option.side];

    for (const width of GLYPH_LINES) {
      const line = div(GLYPH_LINE_CLASSES);

      line.style.width = `${width}px`;
      glyph.appendChild(line);
    }

    button.appendChild(glyph);

    button.addEventListener('pointerenter', () => show(index));
    button.addEventListener('pointerleave', () => show(state.index));
    button.addEventListener('click', () => {
      state.index = index;
      paint();
      options.onPlacementSelect(option.placement);
    });

    buttons.push(button);
    group.appendChild(button);
  });

  paint();

  wrapper.appendChild(preview);
  wrapper.appendChild(group);

  return { element: wrapper };
};
