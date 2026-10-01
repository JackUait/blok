import type { I18n } from '../../../types/api';
import { twMerge } from '../../components/utils/tw';
import type { TextDirection } from '../../components/utils/direction';
import type { CellPlacement } from './types';

interface PlacementPickerOptions {
  i18n: I18n;
  /** The table's direction: in RTL, left/right placements show on the right/left. */
  direction?: TextDirection;
  currentPlacement: CellPlacement | undefined;
  onPlacementSelect: (placement: CellPlacement) => void;
}

interface PlacementPickerResult {
  element: HTMLDivElement;
}

type Row = 'top' | 'middle' | 'bottom';
type Column = 'left' | 'center' | 'right';

const ROWS: Row[] = ['top', 'middle', 'bottom'];
const COLUMNS: Column[] = ['left', 'center', 'right'];

const I18N_KEYS: Record<CellPlacement, string> = {
  'top-left': 'tools.table.placementTopLeft',
  'top-center': 'tools.table.placementTopCenter',
  'top-right': 'tools.table.placementTopRight',
  'middle-left': 'tools.table.placementMiddleLeft',
  'middle-center': 'tools.table.placementMiddleCenter',
  'middle-right': 'tools.table.placementMiddleRight',
  'bottom-left': 'tools.table.placementBottomLeft',
  'bottom-center': 'tools.table.placementBottomCenter',
  'bottom-right': 'tools.table.placementBottomRight',
};

/** Names an RTL option by the side it shows on, since left/right mean the grid's start/end. */
const MIRRORED: Record<CellPlacement, CellPlacement> = {
  'top-left': 'top-right',
  'top-center': 'top-center',
  'top-right': 'top-left',
  'middle-left': 'middle-right',
  'middle-center': 'middle-center',
  'middle-right': 'middle-left',
  'bottom-left': 'bottom-right',
  'bottom-center': 'bottom-center',
  'bottom-right': 'bottom-left',
};

/** Row by row, so option n sits at grid column n % 3, row floor(n / 3). */
const OPTIONS = ROWS.flatMap(row => COLUMNS.map(column => ({
  row,
  column,
  placement: `${row}-${column}` as CellPlacement,
})));

const FLEX: Record<Row | Column, string> = {
  top: 'flex-start',
  middle: 'center',
  bottom: 'flex-end',
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
};

/** Text lines of the small option glyphs, in px. */
const GLYPH_LINES = [12, 8];

/**
 * Text lines of the preview card, in px, laid out in a PREVIEW_TEXT_WIDTH box:
 * the 184px card minus its 14px padding on each side.
 */
const PREVIEW_TEXT_WIDTH = 156;
const PREVIEW_LINES = [104, 64, 88];

/**
 * Where the text box's top sits for each row: 12px padding in an 84px card
 * holding three 4px lines 6px apart (24px of text).
 */
const PREVIEW_TOP: Record<Row, number> = {
  top: 12,
  middle: 30,
  bottom: 48,
};

/** How far a line of this width sits from the inline start when aligned to this column. */
const offsetOf = (column: Column, width: number): number => {
  if (column === 'left') {
    return 0;
  }

  return column === 'center' ? (PREVIEW_TEXT_WIDTH - width) / 2 : PREVIEW_TEXT_WIDTH - width;
};

/**
 * Same motion as the cell glide: accelerates from rest, then brakes hard,
 * without overshoot. Longer or springy motion reads as lag after the click.
 */
const EASE_IN_OUT = '[transition-timing-function:cubic-bezier(0.7,0,0.2,1)]';

/** -1 in an RTL popover. paint() runs before the picker is attached, so CSS resolves it. */
const INLINE_SIGN = 'var(--_blok-inline-sign, 1)';

const MOTION = [
  'transition-transform',
  'duration-[240ms]',
  EASE_IN_OUT,
  'motion-reduce:transition-none',
];

/** Same width, radius and neutral surface as the options track below it. */
const PREVIEW_CLASSES = [
  'relative',
  'h-[84px]',
  'mb-1.5',
  'rounded-(--blok-radius-control-lg)',
  'bg-item-hover-bg',
  'overflow-hidden',
];

const TEXT_BOX_CLASSES = [
  'absolute',
  'top-0',
  'inset-x-[14px]',
  'flex',
  'flex-col',
  'gap-[6px]',
  ...MOTION,
];

const PREVIEW_LINE_CLASSES = [
  'h-1',
  'rounded-full',
  'bg-current',
  ...MOTION,
];

const GROUP_CLASSES = [
  'relative',
  'grid',
  'grid-cols-3',
  'p-(--blok-space-0-75)',
  'rounded-(--blok-radius-control-lg)',
  // The thumb and options round to this, so they stay concentric with the track.
  '[--blok-radius-inner:max(var(--blok-radius-floor),calc(var(--blok-radius-control-lg)-var(--blok-space-0-75)))]',
  'shadow-[inset_0_0_0_1px_var(--blok-border-secondary)]',
];

/**
 * The selection is a neutral surface that slides between options — never blue.
 * It is one grid cell in size, so translate(col * 100%, row * 100%) lands on it.
 * Left/right mean start/end, so x steps toward the inline end.
 */
const THUMB_CLASSES = [
  'absolute',
  'top-[3px]',
  'start-[3px]',
  'w-[calc((100%-6px)/3)]',
  'h-[calc((100%-6px)/3)]',
  'rounded-(--blok-radius-inner)',
  'bg-icon-active-bg',
  'pointer-events-none',
  ...MOTION,
];

const OPTION_CLASSES = [
  'relative',
  'flex',
  'items-center',
  'justify-center',
  'h-8',
  'rounded-(--blok-radius-inner)',
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

/**
 * A tiny outlined cell with two text lines pushed to the option's corner, edge
 * or centre. The outline is what makes the row readable at a glance.
 * [border-color:…] because twMerge drops `border` next to some border-color utilities.
 */
const GLYPH_CLASSES = [
  'flex',
  'flex-col',
  'gap-[2px]',
  'w-5',
  'h-4',
  'p-[2px]',
  'rounded-(--blok-radius-control-sm)',
  'border',
  '[border-color:color-mix(in_srgb,currentColor_30%,transparent)]',
  'pointer-events-none',
];

/** Whole-pixel lines: fractional ones blur differently in each row. */
const GLYPH_LINE_CLASSES = [
  'h-[2px]',
  'rounded-full',
  'bg-current',
];

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

  textBox.setAttribute('data-blok-placement-preview-text', '');

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
  const current = options.currentPlacement ?? 'top-left';
  const state = { index: Math.max(0, OPTIONS.findIndex(option => option.placement === current)) };

  /** Shows one option in the preview without committing it. */
  const show = (index: number): void => {
    const { row, column } = OPTIONS[index];

    textBox.style.transform = `translateY(${PREVIEW_TOP[row]}px)`;
    for (const [lineIndex, line] of previewLines.entries()) {
      line.style.transform = `translateX(calc(${offsetOf(column, PREVIEW_LINES[lineIndex])}px * ${INLINE_SIGN}))`;
    }
  };

  const paint = (): void => {
    buttons.forEach((button, index) => {
      button.setAttribute('aria-checked', String(index === state.index));
    });
    thumb.style.transform = `translate(calc(${(state.index % 3) * 100}% * ${INLINE_SIGN}), ${Math.floor(state.index / 3) * 100}%)`;
    show(state.index);
  };

  OPTIONS.forEach((option, index) => {
    const button = document.createElement('button');

    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.setAttribute('data-placement', option.placement);
    const shown = options.direction === 'rtl' ? MIRRORED[option.placement] : option.placement;

    button.setAttribute('aria-label', options.i18n.t(I18N_KEYS[shown]));
    button.className = twMerge(OPTION_CLASSES);

    const glyph = div(GLYPH_CLASSES);

    glyph.setAttribute('data-blok-placement-glyph', '');
    glyph.style.justifyContent = FLEX[option.row];
    glyph.style.alignItems = FLEX[option.column];

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
