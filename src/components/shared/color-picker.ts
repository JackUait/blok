import type { I18n } from '../../../types/api';
import { DATA_ATTR } from '../constants/data-attributes';
import { parseColor } from '../utils/color-mapping';
import { generateId } from '../utils/id-generator';
import { isKeyboardModality } from '../utils/input-modality';
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
 * Compose the localized label for a color entry ("Red text color" /
 * "Цвет текста: Красный") from the locale's swatch-label template, so each
 * locale controls the color name, word order and casing. Pass a preset name
 * for a color entry, or null for the Default (reset) entry.
 * @param i18n - translator resolving the template and color keys
 * @param modeLabelKey - i18n key of the axis label, e.g. 'tools.marker.textColor'
 * @param presetName - preset name ('red', …) or null for the Default entry
 */
export const formatSwatchLabel = (i18n: Pick<I18n, 't'>, modeLabelKey: string, presetName: string | null): string => {
  const label = presetName === null
    ? i18n.t('tools.colorPicker.defaultSwatchLabel').replace('{default}', i18n.t('tools.marker.default'))
    : i18n.t('tools.colorPicker.colorSwatchLabel').replace('{color}', i18n.t('tools.colorPicker.color.' + presetName));
  const composed = label.replace('{mode}', i18n.t(modeLabelKey).toLowerCase());

  return composed.charAt(0).toUpperCase() + composed.slice(1);
};

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
  /**
   * Focus the active swatch of the first section, for a keyboard open only.
   */
  focusActiveSwatch: () => void;
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
 * i18n key for the "Recently used" section title.
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
 * Shared picker for inline, block and table colors.
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
  wrapper.setAttribute(DATA_ATTR.keyboardOwner, '');
  wrapper.className = 'flex flex-col gap-3 p-2';
  const pickerId = generateId('blok-color-picker-');
  const sectionGrids: HTMLDivElement[] = [];

  /**
   * Base swatch button classes shared by every swatch in the picker.
   */
  const swatchClassName = twMerge(
    'w-10 h-10 rounded-(--blok-radius-control-lg) cursor-pointer border-none outline-hidden',
    'flex items-center justify-center text-sm font-semibold',
    'ring-inset hover:ring-2 hover:ring-swatch-ring-hover aria-pressed:ring-swatch-ring-active',
    'focus-visible:ring-2 focus-visible:ring-focus-ring aria-pressed:focus-visible:ring-focus-ring',
    'transition-[box-shadow,transform,scale] duration-150 active:scale-[0.96]',
    'motion-reduce:transition-none motion-reduce:active:scale-100'
  );

  const recentSectionHost = document.createElement('div');

  /**
   * Render (or clear) the "Recently used" section from localStorage. Entries
   * whose axis has no matching mode in this picker are skipped.
   */
  const renderRecentSection = (): void => {
    const focusedTestId = recentSectionHost.contains(document.activeElement)
      ? document.activeElement?.getAttribute('data-blok-testid')
      : null;

    recentSectionHost.replaceChildren();
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
    section.className = 'flex flex-col gap-2';

    const title = document.createElement('div');

    title.className = 'text-xs font-medium text-text-secondary px-0.5';
    title.textContent = i18n.t(RECENTLY_USED_LABEL_KEY);

    const grid = document.createElement('div');

    grid.className = 'grid gap-1.5';
    grid.style.gridTemplateColumns = 'repeat(5, 2.5rem)';

    for (const { entry, mode, preset } of recents) {
      if (mode === undefined || preset === undefined) {
        continue;
      }

      const swatch = document.createElement('button');
      const swatchColor = entry.field === 'text' ? preset.text : preset.bg;
      const label = formatSwatchLabel(i18n, mode.labelKey, entry.name);

      swatch.setAttribute('data-blok-testid', `${testIdPrefix}-swatch-recent-${entry.field}-${entry.name}`);
      swatch.type = 'button';
      swatch.className = swatchClassName;
      // No aria-pressed here: recents never render the active ring, and this section is
      // not re-rendered by setActiveColor, so a pressed state written here would go stale.
      swatch.setAttribute('aria-label', label);
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
      onHover(swatch, label, { placement: 'top' });
      grid.appendChild(swatch);
    }

    section.appendChild(title);
    section.appendChild(grid);
    recentSectionHost.appendChild(section);
    recentSectionHost.hidden = false;

    if (focusedTestId) {
      Array.from(grid.children).find((child): child is HTMLButtonElement =>
        child instanceof HTMLButtonElement && child.getAttribute('data-blok-testid') === focusedTestId
      )?.focus({ preventScroll: true });
    }
  };

  // Recents lead, like Notion; the sections follow.
  wrapper.appendChild(recentSectionHost);

  modes.forEach((mode, modeIndex) => {
    const section = document.createElement('div');
    const title = document.createElement('div');
    const grid = document.createElement('div');

    title.id = `${pickerId}-title-${modeIndex}`;
    title.className = 'text-xs font-medium text-text-secondary px-0.5';
    title.textContent = i18n.t(mode.labelKey);

    section.setAttribute('data-blok-testid', `${testIdPrefix}-section-${mode.key}`);
    section.setAttribute('role', 'group');
    section.setAttribute('aria-labelledby', title.id);
    section.className = 'flex flex-col gap-2';

    grid.className = 'grid gap-1.5';
    grid.style.gridTemplateColumns = 'repeat(5, 2.5rem)';
    sectionGrids.push(grid);
    section.append(title, grid);
    wrapper.appendChild(section);
  });

  /**
   * Render the swatches for one section.
   */
  const renderSection = (modeIndex: number): void => {
    const grid = sectionGrids[modeIndex];
    const mode = modes[modeIndex];
    const presets = getActivePresets();

    const activeColor = state.activeColors[mode.key];

    [null, ...presets].forEach((preset, index) => {
      // Keep the buttons mounted: callers update selection during their click callback.
      const existing = grid.children[index];
      const swatch = existing instanceof HTMLButtonElement ? existing : document.createElement('button');
      const swatchColor = preset?.[mode.presetField] ?? null;
      const isActive = swatchColor === null ? activeColor === null : activeColor !== null && colorsEqual(swatchColor, activeColor);
      const label = formatSwatchLabel(i18n, mode.labelKey, preset?.name ?? null);

      swatch.setAttribute('data-blok-testid', `${testIdPrefix}-swatch-${mode.key}-${preset?.name ?? 'default'}`);
      swatch.type = 'button';
      swatch.className = twMerge(swatchClassName, isActive && 'ring-2 ring-swatch-ring-hover');
      swatch.setAttribute('aria-label', label);
      swatch.setAttribute('aria-pressed', String(isActive));
      swatch.textContent = mode.presetField === 'text' ? 'A' : '';
      const backgroundText = presets === COLOR_PRESETS_DARK ? preset?.text ?? 'var(--blok-text-primary)' : '#37352f';

      swatch.style.color = mode.presetField === 'text'
        ? preset?.text ?? 'var(--blok-text-primary)'
        : backgroundText;
      swatch.style.backgroundColor = mode.presetField === 'bg'
        ? preset?.bg ?? SWATCH_NEUTRAL_BG
        : SWATCH_NEUTRAL_BG;

      if (existing === undefined) {
        swatch.addEventListener('click', () => {
          const currentPreset = getActivePresets().find((entry) => entry.name === preset?.name);

          if (currentPreset) {
            recordRecentColor({ name: currentPreset.name, field: mode.presetField });
            renderRecentSection();
          }
          onColorSelect(currentPreset?.[mode.presetField] ?? null, mode.key);
        });
        onHover(swatch, label, { placement: 'top' });
        grid.appendChild(swatch);
      }
    });
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
    focusActiveSwatch: () => {
      // A mouse open must not paint a focus ring.
      if (!isKeyboardModality()) {
        return;
      }
      sectionGrids[0]?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
    },
  };
}
