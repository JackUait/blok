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
export function getActivePresets(): typeof COLOR_PRESETS {
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
  /**
   * Seed the active-color indicator per mode so the picker opens showing the
   * target's currently-applied color (a checkmark/ring on the matching swatch)
   * instead of always defaulting to the Default swatch. Missing/undefined keys
   * fall back to null (Default active).
   */
  initialActiveColors?: Record<string, string | null>;
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
 * localStorage key holding recently used colors, shared by every picker
 * instance (marker, table cells, block settings).
 */
const RECENT_COLORS_STORAGE_KEY = 'blok-recent-colors';

/**
 * Maximum number of entries in the "Recently used" section.
 */
const RECENT_COLORS_LIMIT = 5;

/**
 * i18n key for the "Recently used" section title. DELIBERATELY not yet added
 * to the locale dictionaries: doing so resets the translation audit ledger's
 * completed pass evidence (rule 2). Until the audit stabilizes and the key is
 * added to all locales, the title falls back to English via i18n.has().
 */
const RECENTLY_USED_LABEL_KEY = 'tools.colorPicker.recentlyUsed';

/**
 * One recently used color: the preset name plus the axis it was applied on.
 * Preset names (not raw CSS values) are stored so entries resolve to the
 * correct value under either theme.
 */
interface RecentColorEntry {
  name: string;
  field: 'text' | 'bg';
}

/**
 * Read the recently used colors from localStorage, most recent first.
 * Corrupt or unavailable storage yields an empty list.
 */
function getRecentColors(): RecentColorEntry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_COLORS_STORAGE_KEY) ?? '[]');

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry): entry is RecentColorEntry => {
      return typeof entry === 'object' && entry !== null &&
        typeof (entry as RecentColorEntry).name === 'string' &&
        ((entry as RecentColorEntry).field === 'text' || (entry as RecentColorEntry).field === 'bg');
    });
  } catch {
    return [];
  }
}

/**
 * Record a picked color at the front of the recents list, deduplicating by
 * name+field and capping at {@link RECENT_COLORS_LIMIT}.
 * @param entry - the picked preset name and axis
 */
function recordRecentColor(entry: RecentColorEntry): void {
  const rest = getRecentColors().filter((e) => e.name !== entry.name || e.field !== entry.field);

  try {
    localStorage.setItem(
      RECENT_COLORS_STORAGE_KEY,
      JSON.stringify([entry, ...rest].slice(0, RECENT_COLORS_LIMIT))
    );
  } catch {
    // Storage unavailable (private mode, quota) — recents just won't persist.
  }
}

/**
 * Creates a color picker element with two always-visible sections (e.g. Text / Background),
 * each containing a 5-column swatch grid with a "Default" reset swatch at position 0.
 *
 * Shared between the marker inline tool and the table cell color popover.
 */
export function createColorPicker(options: ColorPickerOptions): ColorPickerHandle {
  const { i18n, modes, testIdPrefix, onColorSelect, initialActiveColors } = options;
  const state = {
    activeColors: Object.fromEntries(
      modes.map((m) => [m.key, initialActiveColors?.[m.key] ?? null])
    ) as Record<string, string | null>,
  };

  const wrapper = document.createElement('div');

  wrapper.setAttribute('data-blok-testid', `${testIdPrefix}-picker`);
  wrapper.className = 'flex flex-col gap-3 p-2';

  /**
   * One grid element per section, stored so we can re-render independently.
   */
  const sectionGrids: HTMLDivElement[] = [];

  /**
   * Base swatch button classes shared by every swatch in the picker.
   */
  const swatchClassName = twMerge(
    'w-9 h-9 rounded-md cursor-pointer border-none outline-hidden',
    'flex items-center justify-center text-sm font-semibold',
    'transition-[box-shadow,transform] ring-inset hover:ring-2 hover:ring-swatch-ring-hover active:scale-90'
  );

  /**
   * Container for the "Recently used" section, kept above the mode sections
   * and re-rendered whenever a color is picked. Empty when there are no recents.
   */
  const recentSectionHost = document.createElement('div');

  wrapper.appendChild(recentSectionHost);

  /**
   * Render (or clear) the "Recently used" section from localStorage. Entries
   * whose axis has no matching mode in this picker are skipped.
   */
  const renderRecentSection = (): void => {
    recentSectionHost.innerHTML = '';
    // An empty flex child would still produce a stray wrapper gap — hide it.
    recentSectionHost.hidden = true;

    const presets = getActivePresets();
    const recents = getRecentColors()
      .map((entry) => ({
        entry,
        mode: modes.find((m) => m.presetField === entry.field),
        preset: presets.find((p) => p.name === entry.name),
      }))
      .filter((r) => r.mode !== undefined && r.preset !== undefined);

    if (recents.length === 0) {
      return;
    }

    const section = document.createElement('div');

    section.setAttribute('data-blok-testid', `${testIdPrefix}-section-recent`);
    section.className = 'flex flex-col gap-1';

    const title = document.createElement('div');

    title.className = 'text-xs font-medium text-text-primary/60 px-0.5';
    // typeof guard: tools may hand the picker a partial i18n without has().
    const hasTranslation = typeof i18n.has === 'function' && i18n.has(RECENTLY_USED_LABEL_KEY);

    title.textContent = hasTranslation ? i18n.t(RECENTLY_USED_LABEL_KEY) : 'Recently used';

    const grid = document.createElement('div');

    grid.className = 'grid gap-1';
    grid.style.gridTemplateColumns = 'repeat(5, 2.25rem)';

    for (const { entry, mode, preset } of recents) {
      if (mode === undefined || preset === undefined) {
        continue;
      }

      const swatch = document.createElement('button');
      const swatchColor = entry.field === 'text' ? preset.text : preset.bg;

      swatch.setAttribute('data-blok-testid', `${testIdPrefix}-swatch-recent-${entry.field}-${entry.name}`);
      swatch.className = swatchClassName;
      swatch.textContent = entry.field === 'text' ? 'A' : '';

      if (entry.field === 'text') {
        swatch.style.color = preset.text;
        swatch.style.backgroundColor = SWATCH_NEUTRAL_BG;
      } else {
        swatch.style.color = presets === COLOR_PRESETS_DARK ? preset.text : '#37352f';
        swatch.style.backgroundColor = preset.bg;
      }

      swatch.addEventListener('click', () => {
        recordRecentColor(entry);
        renderRecentSection();
        onColorSelect(swatchColor, mode.key);
      });
      const colorLabel = i18n.t('tools.colorPicker.colorSwatchLabel')
        .replace('{color}', i18n.t('tools.colorPicker.color.' + entry.name))
        .replace('{mode}', i18n.t(mode.labelKey).toLowerCase());

      onHover(swatch, colorLabel.charAt(0).toUpperCase() + colorLabel.slice(1), { placement: 'top' });
      grid.appendChild(swatch);
    }

    section.appendChild(title);
    section.appendChild(grid);
    recentSectionHost.appendChild(section);
    recentSectionHost.hidden = false;
  };

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
    defaultSwatch.className = twMerge(swatchClassName, isDefaultActive && 'ring-2 ring-swatch-ring-hover');
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
    const defaultLabel = i18n.t('tools.colorPicker.defaultSwatchLabel')
      .replace('{default}', i18n.t('tools.marker.default'))
      .replace('{mode}', i18n.t(mode.labelKey).toLowerCase());

    onHover(defaultSwatch, defaultLabel.charAt(0).toUpperCase() + defaultLabel.slice(1), { placement: 'top' });
    grid.appendChild(defaultSwatch);

    for (const preset of presets) {
      const swatch = document.createElement('button');
      const swatchColor = mode.presetField === 'text' ? preset.text : preset.bg;
      const isActive = activeColorForSection !== null && colorsEqual(swatchColor, activeColorForSection);

      swatch.setAttribute('data-blok-testid', `${testIdPrefix}-swatch-${mode.key}-${preset.name}`);
      swatch.className = twMerge(swatchClassName, isActive && 'ring-2 ring-swatch-ring-hover');
      swatch.textContent = mode.presetField === 'text' ? 'A' : '';

      if (mode.presetField === 'text') {
        swatch.style.color = preset.text;
        swatch.style.backgroundColor = SWATCH_NEUTRAL_BG;
      } else {
        swatch.style.color = presets === COLOR_PRESETS_DARK ? preset.text : '#37352f';
        swatch.style.backgroundColor = preset.bg;
      }

      swatch.addEventListener('click', () => {
        recordRecentColor({ name: preset.name, field: mode.presetField });
        renderRecentSection();
        onColorSelect(swatchColor, mode.key);
      });
      const colorLabel = i18n.t('tools.colorPicker.colorSwatchLabel')
        .replace('{color}', i18n.t('tools.colorPicker.color.' + preset.name))
        .replace('{mode}', i18n.t(mode.labelKey).toLowerCase());

      onHover(swatch, colorLabel.charAt(0).toUpperCase() + colorLabel.slice(1), { placement: 'top' });
      grid.appendChild(swatch);
    }
  };

  const renderAll = (): void => {
    modes.forEach((_, i) => renderSection(i));
  };

  renderRecentSection();
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
