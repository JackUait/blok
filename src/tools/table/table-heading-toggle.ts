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
  'p-[var(--item-padding)]',
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
  'duration-200',
  'shrink-0',
];

const THUMB_CLASSES = [
  'absolute',
  'top-[2px]',
  'w-4',
  'h-4',
  'rounded-full',
  'bg-white',
  'shadow-sm',
  'transition-[left]',
  'duration-200',
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
    track.style.backgroundColor = state.active ? '#3b82f6' : '#d1d5db';
    thumb.style.left = state.active ? '16px' : '2px';
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
