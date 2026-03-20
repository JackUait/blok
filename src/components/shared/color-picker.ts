import type { I18n } from '../../../types/api';
import { parseColor } from '../utils/color-mapping';
import { onHover } from '../utils/tooltip';
import { twMerge } from '../utils/tw';
import { COLOR_PRESETS, COLOR_PRESETS_DARK } from './color-presets';

/**
 * Returns the appropriate preset array for the current theme.
 * Checks the data-blok-theme attribute first (explicit override),
 * then falls back to the prefers-color-scheme media query.
 */
function getActivePresets(): typeof COLOR_PRESETS {
  const theme = document.documentElement.getAttribute('data-blok-theme');

  if (theme === 'dark') return COLOR_PRESETS_DARK;
  if (theme === 'light') return COLOR_PRESETS;

  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return COLOR_PRESETS_DARK;
  }

  return COLOR_PRESETS;
}

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
 * Describes one section in the color picker (e.g. "Text" or "Background")
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
   * Pass null to clear any active indicator for that section.
   * @param color - CSS color value or null to clear
   * @param modeKey - The mode key (e.g. 'color', 'background-color') to match the correct section
   */
  setActiveColor: (color: string | null, modeKey: string) => void;
  /**
   * Reset the picker state back to defaults (clear all active colors).
   */
  reset: () => void;
}

/**
 * Neutral background for text-mode swatches so they render as visible buttons.
 * Uses a CSS variable so it adapts to dark mode.
 */
const SWATCH_NEUTRAL_BG = 'var(--blok-swatch-neutral-bg)';

/**
 * Creates a color picker element with two always-visible sections (e.g. Text / Background),
 * each containing a 5-column swatch grid with a "Default" reset swatch at position 0.
 *
 * Shared between the marker inline tool and the table cell color popover.
 */
export function createColorPicker(options: ColorPickerOptions): ColorPickerHandle {
  const { i18n, modes, testIdPrefix, onColorSelect } = options;
  const state = {
    activeColors: Object.fromEntries(modes.map((m) => [m.key, null])) as Record<string, string | null>,
  };

  const wrapper = document.createElement('div');

  wrapper.setAttribute('data-blok-testid', `${testIdPrefix}-picker`);
  wrapper.className = 'flex flex-col gap-3 p-2';

  /**
   * One grid element per section, stored so we can re-render independently.
   */
  const sectionGrids: HTMLDivElement[] = [];

  /**
   * Build sections once; re-render only the grids on state changes.
   */
  modes.forEach((mode) => {
    const section = document.createElement('div');

    section.setAttribute('data-blok-testid', `${testIdPrefix}-section-${mode.key}`);
    section.className = 'flex flex-col gap-1';

    const title = document.createElement('div');

    title.className = 'text-xs font-medium text-text-primary/60 px-0.5';
    title.textContent = i18n.t(mode.labelKey);

    const grid = document.createElement('div');

    grid.className = 'grid gap-1';
    grid.style.gridTemplateColumns = 'repeat(5, 2.25rem)';
    sectionGrids.push(grid);

    section.appendChild(title);
    section.appendChild(grid);
    wrapper.appendChild(section);
  });

  /**
   * Render the swatches for one section.
   */
  const renderSection = (modeIndex: number): void => {
    const grid = sectionGrids[modeIndex];
    const mode = modes[modeIndex];
    const presets = getActivePresets();

    grid.innerHTML = '';

    const activeColorForSection = state.activeColors[mode.key];

    // Default swatch (first position) — clears the active color for this section
    const defaultSwatch = document.createElement('button');
    const isDefaultActive = activeColorForSection === null;

    defaultSwatch.setAttribute('data-blok-testid', `${testIdPrefix}-swatch-${mode.key}-default`);
    defaultSwatch.className = twMerge(
      'w-9 h-9 rounded-md cursor-pointer border-none outline-hidden',
      'flex items-center justify-center text-sm font-semibold',
      'transition-[box-shadow,transform] ring-inset hover:ring-2 hover:ring-swatch-ring-hover active:scale-90',
      isDefaultActive && 'ring-2 ring-swatch-ring-hover'
    );
    defaultSwatch.textContent = mode.presetField === 'text' ? 'A' : '';

    if (mode.presetField === 'text') {
      defaultSwatch.style.color = 'var(--blok-text-primary)';
      defaultSwatch.style.backgroundColor = SWATCH_NEUTRAL_BG;
    } else {
      defaultSwatch.style.backgroundColor = SWATCH_NEUTRAL_BG;
    }
    defaultSwatch.addEventListener('click', () => {
      onColorSelect(null, mode.key);
    });
    onHover(defaultSwatch, `${i18n.t('tools.marker.default')} ${i18n.t(mode.labelKey).toLowerCase()}`, { placement: 'top' });
    grid.appendChild(defaultSwatch);

    for (const preset of presets) {
      const swatch = document.createElement('button');
      const swatchColor = mode.presetField === 'text' ? preset.text : preset.bg;
      const isActive = activeColorForSection !== null && colorsEqual(swatchColor, activeColorForSection);

      swatch.setAttribute('data-blok-testid', `${testIdPrefix}-swatch-${mode.key}-${preset.name}`);
      swatch.className = twMerge(
        'w-9 h-9 rounded-md cursor-pointer border-none outline-hidden',
        'flex items-center justify-center text-sm font-semibold',
        'transition-[box-shadow,transform] ring-inset hover:ring-2 hover:ring-swatch-ring-hover active:scale-90',
        isActive && 'ring-2 ring-swatch-ring-hover'
      );
      swatch.textContent = mode.presetField === 'text' ? 'A' : '';

      if (mode.presetField === 'text') {
        swatch.style.color = preset.text;
        swatch.style.backgroundColor = SWATCH_NEUTRAL_BG;
      } else {
        swatch.style.color = presets === COLOR_PRESETS_DARK ? preset.text : '#37352f';
        swatch.style.backgroundColor = preset.bg;
      }

      swatch.addEventListener('click', () => {
        onColorSelect(swatchColor, mode.key);
      });
      onHover(swatch, `${i18n.t('tools.colorPicker.color.' + preset.name)} ${i18n.t(mode.labelKey).toLowerCase()}`, { placement: 'top' });
      grid.appendChild(swatch);
    }
  };

  const renderAll = (): void => {
    modes.forEach((_, i) => renderSection(i));
  };

  renderAll();

  return {
    element: wrapper,
    setActiveColor: (color: string | null, modeKey: string) => {
      const matchingIndex = modes.findIndex((m) => m.key === modeKey);

      if (matchingIndex !== -1) {
        state.activeColors[modeKey] = color;
        renderSection(matchingIndex);
      }
    },
    reset: () => {
      for (const mode of modes) {
        state.activeColors[mode.key] = null;
      }
      renderAll();
    },
  };
}
