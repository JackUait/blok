import type { I18n } from '../../../types/api';
import { parseColor } from '../utils/color-mapping';
import { twMerge } from '../utils/tw';
import { COLOR_PRESETS } from './color-presets';

/**
 * Compare two CSS color strings for equality by their parsed RGB tuples.
 * Handles hex vs rgb() format mismatches (e.g. '#d44c47' vs 'rgb(212, 76, 71)').
 */
function colorsEqual(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }

  const rgbA = parseColor(a);
  const rgbB = parseColor(b);

  if (rgbA === null || rgbB === null) {
    return false;
  }

  return rgbA[0] === rgbB[0] && rgbA[1] === rgbB[1] && rgbA[2] === rgbB[2];
}

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
 * Handle returned by createColorPicker with the DOM element and control methods
 */
export interface ColorPickerHandle {
  element: HTMLDivElement;
  /**
   * Set the currently active color for visual indication on the matching swatch.
   * Pass null to clear any active indicator.
   * @param color - CSS color value or null to clear
   * @param modeKey - The mode key (e.g. 'color', 'background-color') to match the correct preset field
   */
  setActiveColor: (color: string | null, modeKey: string) => void;
  /**
   * Reset the picker state (tab index) back to defaultModeIndex.
   * Call this when the picker is reopened to ensure consistent initial state.
   */
  reset: () => void;
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
export function createColorPicker(options: ColorPickerOptions): ColorPickerHandle {
  const { i18n, modes, testIdPrefix, onColorSelect } = options;
  const defaultModeIndex = options.defaultModeIndex ?? 0;
  const state = { modeIndex: defaultModeIndex, activeColor: null as string | null };

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
    for (const [index, button] of tabButtons.entries()) {
      button.className = twMerge(
        TAB_BASE_CLASSES,
        index === state.modeIndex ? 'bg-item-hover-bg font-medium' : 'bg-transparent hover:bg-item-hover-bg/50'
      );
    }
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
      const swatchColor = currentMode.presetField === 'text' ? preset.text : preset.bg;
      const isActive = state.activeColor !== null && colorsEqual(swatchColor, state.activeColor);

      swatch.setAttribute('data-blok-testid', `${testIdPrefix}-swatch-${preset.name}`);
      swatch.className = twMerge(
        'w-8 h-8 rounded-md cursor-pointer border-none',
        'flex items-center justify-center text-sm font-semibold',
        'transition-shadow ring-inset hover:ring-2 hover:ring-black/10',
        isActive && 'ring-2 ring-black/30'
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
        onColorSelect(swatchColor, currentMode.key);
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

  return {
    element: wrapper,
    setActiveColor: (color: string | null, modeKey: string) => {
      state.activeColor = color;

      const matchingIndex = modes.findIndex((m) => m.key === modeKey);

      if (matchingIndex !== -1) {
        state.modeIndex = matchingIndex;
        updateTabs();
      }

      renderSwatches();
    },
    reset: () => {
      state.modeIndex = defaultModeIndex;
      state.activeColor = null;
      updateTabs();
      renderSwatches();
    },
  };
}
