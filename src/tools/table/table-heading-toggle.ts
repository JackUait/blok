import { twMerge } from '../../components/utils/tw';

const TOGGLE_ROW_CLASSES = [
  'flex',
  'items-center',
  'gap-2',
  'px-3',
  'py-2',
  'cursor-pointer',
  'select-none',
  'min-w-[200px]',
];

const ICON_WRAPPER_CLASSES = [
  'flex',
  'items-center',
  'justify-center',
  'w-[26px]',
  'h-[26px]',
  'shrink-0',
  '[&_svg]:w-5',
  '[&_svg]:h-5',
  'text-gray-600',
];

const LABEL_CLASSES = [
  'flex-1',
  'text-sm',
  'text-gray-800',
  'leading-normal',
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
