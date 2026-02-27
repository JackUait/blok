import type { I18n } from '../../../types/api';
import { twMerge } from '../utils/tw';
import { COLOR_PRESETS } from './color-presets';

/**
 * Describes one tab in the color picker (e.g. "Text" or "Background")
 */
export interface ColorPickerMode {
  key: string;
  labelKey: string;
  presetField: 'text' | 'bg';
}

/**
 * Options for the shared color picker factory
 */
export interface ColorPickerOptions {
  i18n: I18n;
  modes: [ColorPickerMode, ColorPickerMode];
  defaultModeIndex?: number;
  testIdPrefix: string;
  onColorSelect: (color: string | null, modeKey: string) => void;
}

/**
 * Base Tailwind classes shared by tab buttons
 */
const TAB_BASE_CLASSES = 'flex-1 py-1.5 text-xs text-center rounded-md cursor-pointer border-none transition-colors';

/**
 * Neutral background for text-mode swatches so they render as visible buttons
 */
const SWATCH_NEUTRAL_BG = '#f7f7f5';

/**
 * Creates a color picker element with two tabs (e.g. Text / Background),
 * a 5-column swatch grid, and a "Default" reset button.
 *
 * Shared between the marker inline tool and the table cell color popover.
 */
export function createColorPicker(options: ColorPickerOptions): HTMLDivElement {
  const { i18n, modes, testIdPrefix, onColorSelect } = options;
  const state = { modeIndex: options.defaultModeIndex ?? 0 };

  const wrapper = document.createElement('div');

  wrapper.setAttribute('data-blok-testid', `${testIdPrefix}-picker`);
  wrapper.className = 'flex flex-col gap-2 p-2';

  /**
   * Tab row
   */
  const tabRow = document.createElement('div');

  tabRow.className = 'flex gap-0.5 mb-0.5';

  const tabButtons: HTMLButtonElement[] = [];

  modes.forEach((mode, modeIndex) => {
    const tab = document.createElement('button');

    tab.setAttribute('data-blok-testid', `${testIdPrefix}-tab-${mode.key}`);
    tab.textContent = i18n.t(mode.labelKey);
    tab.addEventListener('click', () => {
      state.modeIndex = modeIndex;
      updateTabs();
      renderSwatches();
    });
    tabButtons.push(tab);
    tabRow.appendChild(tab);
  });

  const updateTabs = (): void => {
    tabButtons.forEach((tab, index) => {
      tab.className = twMerge(
        TAB_BASE_CLASSES,
        index === state.modeIndex ? 'bg-item-hover-bg font-medium' : 'bg-transparent hover:bg-item-hover-bg/50'
      );
    });
  };

  /**
   * Color grid
   */
  const grid = document.createElement('div');

  grid.setAttribute('data-blok-testid', `${testIdPrefix}-grid`);
  grid.className = 'grid grid-cols-5 gap-1.5';

  const renderSwatches = (): void => {
    grid.innerHTML = '';

    const currentMode = modes[state.modeIndex];

    for (const preset of COLOR_PRESETS) {
      const swatch = document.createElement('button');

      swatch.setAttribute('data-blok-testid', `${testIdPrefix}-swatch-${preset.name}`);
      swatch.className = twMerge(
        'w-8 h-8 rounded-md cursor-pointer border-none',
        'flex items-center justify-center text-sm font-semibold',
        'transition-shadow ring-inset hover:ring-2 hover:ring-black/10'
      );
      swatch.textContent = 'A';

      if (currentMode.presetField === 'text') {
        swatch.style.color = preset.text;
        swatch.style.backgroundColor = SWATCH_NEUTRAL_BG;
      } else {
        swatch.style.color = '';
        swatch.style.backgroundColor = preset.bg;
      }

      swatch.addEventListener('click', () => {
        const color = currentMode.presetField === 'text' ? preset.text : preset.bg;

        onColorSelect(color, currentMode.key);
      });
      grid.appendChild(swatch);
    }
  };

  /**
   * Default button
   */
  const defaultBtn = document.createElement('button');

  defaultBtn.setAttribute('data-blok-testid', `${testIdPrefix}-default-btn`);
  defaultBtn.className = twMerge(
    'w-full py-1.5 text-xs text-center rounded-md cursor-pointer',
    'bg-transparent border-none hover:bg-item-hover-bg',
    'mt-0.5 transition-colors'
  );
  defaultBtn.textContent = i18n.t('tools.marker.default');
  defaultBtn.addEventListener('click', () => {
    onColorSelect(null, modes[state.modeIndex].key);
  });

  /**
   * Assemble
   */
  updateTabs();
  renderSwatches();

  wrapper.appendChild(tabRow);
  wrapper.appendChild(grid);
  wrapper.appendChild(defaultBtn);

  return wrapper;
}
