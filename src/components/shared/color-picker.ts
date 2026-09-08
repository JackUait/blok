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
  const sections: HTMLDivElement[] = [];
  const previews: HTMLSpanElement[] = [];
  const colorNames: HTMLSpanElement[] = [];
  const modeTabs: HTMLButtonElement[] = [];
  const tabList = document.createElement('div');

  tabList.setAttribute('role', 'tablist');
  tabList.className = 'grid grid-cols-2 gap-1 rounded-lg bg-item-hover-bg p-1';
  wrapper.appendChild(tabList);

  /**
   * Base swatch button classes shared by every swatch in the picker.
   */
  const swatchClassName = twMerge(
    'w-10 h-10 rounded-lg cursor-pointer border-none outline-hidden',
    'flex items-center justify-center text-sm font-semibold',
    'ring-inset hover:ring-2 hover:ring-swatch-ring-hover aria-pressed:ring-swatch-ring-active',
    'focus-visible:ring-2 focus-visible:ring-text-secondary aria-pressed:focus-visible:ring-text-secondary',
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
    section.className = 'flex flex-col gap-2 border-t border-popover-border pt-3';

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
        activateMode(modes.indexOf(mode));
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

  modes.forEach((mode, modeIndex) => {
    const tab = document.createElement('button');
    const section = document.createElement('div');

    tab.type = 'button';
    tab.id = `${pickerId}-tab-${modeIndex}`;
    tab.setAttribute('data-blok-testid', `${testIdPrefix}-tab-${mode.key}`);
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `${pickerId}-panel-${modeIndex}`);
    tab.textContent = i18n.t(mode.labelKey);
    tab.className = twMerge(
      'min-w-0 min-h-8 rounded-md border-none bg-transparent px-2 py-1.5',
      'text-xs font-medium text-text-secondary cursor-pointer outline-hidden',
      'aria-selected:bg-popover-bg aria-selected:text-text-primary aria-selected:shadow-xs',
      'hover:text-text-primary focus-visible:ring-2 focus-visible:ring-text-secondary',
      'transition-colors duration-150 motion-reduce:transition-none'
    );
    // Pointer tabs must not collapse the editor selection or close its toolbar.
    tab.addEventListener('mousedown', (event) => event.preventDefault());
    tab.addEventListener('click', () => activateMode(modeIndex));
    tab.addEventListener('keydown', (event) => {
      const destinations: Record<string, number | undefined> = {
        ArrowLeft: (modeIndex + modes.length - 1) % modes.length,
        ArrowRight: (modeIndex + 1) % modes.length,
        Home: 0,
        End: modes.length - 1,
      };
      const nextIndex = destinations[event.key];

      if (nextIndex === undefined) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      activateMode(nextIndex);
      modeTabs[nextIndex].focus({ preventScroll: true });
    });
    modeTabs.push(tab);
    tabList.appendChild(tab);

    section.id = `${pickerId}-panel-${modeIndex}`;
    section.setAttribute('data-blok-testid', `${testIdPrefix}-section-${mode.key}`);
    section.setAttribute('role', 'tabpanel');
    section.setAttribute('aria-labelledby', tab.id);
    sections.push(section);

    const selected = document.createElement('div');
    const preview = document.createElement('span');
    const colorName = document.createElement('span');
    const resetButton = document.createElement('button');

    selected.className = 'flex items-center gap-2 px-0.5';
    preview.className = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sm font-semibold';
    preview.setAttribute('data-blok-testid', `${testIdPrefix}-preview-${mode.key}`);
    preview.setAttribute('aria-hidden', 'true');
    preview.textContent = 'A';
    previews.push(preview);

    colorName.className = 'min-w-0 flex-1 truncate text-xs font-medium text-text-primary';
    colorName.setAttribute('role', 'status');
    colorNames.push(colorName);

    resetButton.type = 'button';
    resetButton.textContent = i18n.t('tools.marker.default');
    resetButton.setAttribute('data-blok-testid', `${testIdPrefix}-reset-${mode.key}`);
    resetButton.className = twMerge(
      'min-h-8 rounded-md border-none bg-transparent px-2 text-xs text-text-secondary',
      'cursor-pointer hover:bg-item-hover-bg hover:text-text-primary outline-hidden',
      'focus-visible:ring-2 focus-visible:ring-text-secondary'
    );
    resetButton.addEventListener('click', () => onColorSelect(null, mode.key));
    selected.append(preview, colorName, resetButton);

    const grid = document.createElement('div');

    grid.className = 'grid gap-1.5';
    grid.style.gridTemplateColumns = 'repeat(5, 2.5rem)';
    sectionGrids.push(grid);
    section.append(selected, grid);
    wrapper.appendChild(section);
  });
  wrapper.appendChild(recentSectionHost);

  const activateMode = (modeIndex: number): void => {
    const focusedPanel = sections.find((section) => section.contains(document.activeElement));

    modes.forEach((_, index) => {
      const section = sections[index];
      const active = index === modeIndex;

      section.hidden = !active;
      section.className = twMerge('flex flex-col gap-3', !active && 'hidden');
      modeTabs[index].setAttribute('aria-selected', String(active));
      modeTabs[index].tabIndex = active ? 0 : -1;
    });

    /**
     * A tab's mousedown calls preventDefault, so a click never moves focus and
     * never clears Blink's document-level focus-visible flag. Focusing the tab
     * after a mouse click would therefore paint a real ring.
     */
    if ((focusedPanel?.hidden || tabList.contains(document.activeElement)) && isKeyboardModality()) {
      modeTabs[modeIndex].focus({ preventScroll: true });
    }
  };

  /**
   * Render the swatches for one section.
   */
  const renderSection = (modeIndex: number): void => {
    const grid = sectionGrids[modeIndex];
    const mode = modes[modeIndex];
    const presets = getActivePresets();

    const activeColor = state.activeColors[mode.key];
    const activePreset = presets.find((preset) => activeColor !== null && colorsEqual(preset[mode.presetField], activeColor));
    const preview = previews[modeIndex];

    colorNames[modeIndex].textContent = activePreset
      ? i18n.t('tools.colorPicker.color.' + activePreset.name)
      : activeColor ?? i18n.t('tools.marker.default');
    preview.style.color = mode.presetField === 'text'
      ? activeColor ?? 'var(--blok-text-primary)'
      : activePreset?.text ?? 'var(--blok-text-primary)';
    preview.style.backgroundColor = mode.presetField === 'bg'
      ? activeColor ?? SWATCH_NEUTRAL_BG
      : SWATCH_NEUTRAL_BG;

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

  activateMode(0);
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
