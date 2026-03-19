import { twMerge } from '../../components/utils/tw';

/**
 * Matches the default popover item container styling from popover-item-default.const.ts
 */
const TOGGLE_ROW_CLASSES = [
  'flex',
  'items-center',
  'select-none',
  'border-none',
  'bg-transparent',
  'rounded-md',
  'p-(--item-padding)',
  'text-text-primary',
  'mb-px',
  'cursor-pointer',
  'can-hover:hover:bg-item-hover-bg',
];

/**
 * Matches the default popover item icon styling
 */
const ICON_WRAPPER_CLASSES = [
  'flex',
  'items-center',
  'justify-center',
  'w-[26px]',
  'h-[26px]',
  'mr-2',
  '[&_svg]:w-icon',
  '[&_svg]:h-icon',
];

/**
 * Matches the default popover item title styling
 */
const LABEL_CLASSES = [
  'mr-auto',
  'truncate',
  'text-sm',
  'font-medium',
  'leading-5',
];

const TRACK_CLASSES = [
  'relative',
  'w-[34px]',
  'h-[20px]',
  'rounded-full',
  'transition-colors',
  'duration-[180ms]',
  'ease-out',
  'shrink-0',
];

const THUMB_CLASSES = [
  'absolute',
  'top-[2px]',
  'w-4',
  'h-4',
  'rounded-full',
  'bg-white',
  'transition-[left]',
  'duration-[220ms]',
  '[transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)]',
];

interface HeadingToggleOptions {
  icon: string;
  label: string;
  isActive: boolean;
  onToggle: (isActive: boolean) => void;
}

/**
 * Creates a toggle switch element for heading row/column controls.
 * Returns an HTML element suitable for use as a PopoverItemType.Html item.
 */
export const createHeadingToggle = (options: HeadingToggleOptions): HTMLElement => {
  const { icon, label, isActive, onToggle } = options;

  const state = { active: isActive };

  const row = document.createElement('div');

  row.className = twMerge(TOGGLE_ROW_CLASSES);

  // Icon
  const iconWrapper = document.createElement('div');

  iconWrapper.className = twMerge(ICON_WRAPPER_CLASSES);
  iconWrapper.innerHTML = icon;
  row.appendChild(iconWrapper);

  // Label
  const labelEl = document.createElement('span');

  labelEl.className = twMerge(LABEL_CLASSES);
  labelEl.textContent = label;
  row.appendChild(labelEl);

  // Toggle switch
  const track = document.createElement('div');

  track.className = twMerge(TRACK_CLASSES);

  const thumb = document.createElement('div');

  thumb.className = twMerge(THUMB_CLASSES);
  track.appendChild(thumb);
  row.appendChild(track);

  const applyState = (): void => {
    track.style.backgroundColor = state.active ? 'var(--blok-toggle-on-bg)' : 'var(--blok-toggle-off-bg)';
    thumb.style.left = state.active ? '16px' : '2px';
    thumb.style.backgroundColor = state.active ? 'var(--blok-toggle-thumb-on-bg)' : '';
    thumb.style.boxShadow = state.active
      ? '0 1px 3px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.04)'
      : '0 1px 3px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.06)';
  };

  applyState();

  row.addEventListener('click', (e) => {
    e.stopPropagation();
    state.active = !state.active;
    applyState();
    onToggle(state.active);
  });

  return row;
};
