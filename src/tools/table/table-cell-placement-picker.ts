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
 * Text lines of the preview cell, in px, laid out in a PREVIEW_TEXT_WIDTH box.
 * The box width must match the preview's padding: 184px preview, cell edges
 * 16px in, 10px cell padding.
 */
const PREVIEW_TEXT_WIDTH = 132;
const PREVIEW_LINES = [96, 56, 76];

const GUIDE_AT: Record<Side, string> = {
  left: '0%',
  center: '50%',
  right: '100%',
};

/** How far a line of this width sits from the left edge when aligned to this side. */
const offsetOf = (side: Side, width: number): number => {
  if (side === 'left') {
    return 0;
  }

  return side === 'center' ? (PREVIEW_TEXT_WIDTH - width) / 2 : PREVIEW_TEXT_WIDTH - width;
};

const SPRING = '[transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)]';

/**
 * A slice of a table row: the edited cell in the middle, its neighbours
 * fading out at both sides.
 */
const PREVIEW_CLASSES = [
  'relative',
  'h-[76px]',
  'mb-1.5',
  'overflow-hidden',
  'border-y',
  '[border-color:var(--blok-table-border)]',
  '[mask-image:linear-gradient(to_right,transparent,black_28px,black_calc(100%-28px),transparent)]',
];

const CELL_CLASSES = [
  'absolute',
  'inset-y-0',
  'left-4',
  'right-4',
  'border-x',
  '[border-color:var(--blok-table-border)]',
  'bg-popover-bg',
];

const TEXT_BOX_CLASSES = [
  'absolute',
  'left-2.5',
  'right-2.5',
  'top-1/2',
  '-translate-y-1/2',
  'flex',
  'flex-col',
  'gap-[6px]',
];

const PREVIEW_LINE_CLASSES = [
  'h-[5px]',
  'rounded-full',
  'bg-current',
  'transition-transform',
  'duration-[480ms]',
  SPRING,
  'motion-reduce:transition-none',
];

/** Dashed guide on the edge or centre the text snaps to. */
const GUIDE_CLASSES = [
  'absolute',
  '-top-4',
  '-bottom-4',
  'w-0',
  '-ml-px',
  'border-l',
  '[border-style:dashed]',
  'border-text-secondary/50',
  'transition-[left]',
  'duration-[480ms]',
  SPRING,
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
  'duration-[420ms]',
  SPRING,
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

  const cell = div(CELL_CLASSES);
  const textBox = div(TEXT_BOX_CLASSES);
  const guide = div(GUIDE_CLASSES);

  guide.setAttribute('data-blok-placement-guide', '');
  textBox.appendChild(guide);

  const previewLines = PREVIEW_LINES.map((width, index) => {
    const line = div(PREVIEW_LINE_CLASSES);

    line.setAttribute('data-blok-placement-preview-line', '');
    line.style.width = `${width}px`;
    line.style.transitionDelay = `${index * 40}ms`;
    // A heading-like first line over body text.
    line.classList.add(index === 0 ? 'text-text-primary' : 'text-text-secondary');
    textBox.appendChild(line);

    return line;
  });

  cell.appendChild(textBox);
  preview.appendChild(cell);

  const group = div(GROUP_CLASSES);

  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', options.i18n.t('tools.table.placement'));

  const thumb = div(THUMB_CLASSES);

  thumb.setAttribute('data-blok-placement-thumb', '');
  thumb.setAttribute('aria-hidden', 'true');
  group.appendChild(thumb);

  const label = div(LABEL_CLASSES);

  label.setAttribute('data-blok-placement-label', '');
  // The radios already carry their names for assistive tech.
  label.setAttribute('aria-hidden', 'true');

  const buttons: HTMLButtonElement[] = [];
  const state = { index: OPTIONS.findIndex(option => option.side === sideOf(options.currentPlacement)) };

  /** Shows one option in the preview and the label, without committing it. */
  const show = (index: number): void => {
    const { side, key } = OPTIONS[index];

    for (const [lineIndex, line] of previewLines.entries()) {
      line.style.transform = `translateX(${offsetOf(side, PREVIEW_LINES[lineIndex])}px)`;
    }
    guide.style.left = GUIDE_AT[side];
    label.textContent = options.i18n.t(key);
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
  wrapper.appendChild(label);

  return { element: wrapper };
};
