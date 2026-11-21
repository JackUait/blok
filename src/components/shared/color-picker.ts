import type { I18n } from '../../../types/api';
import { DATA_ATTR } from '../constants/data-attributes';
import { parseColor } from '../utils/color-mapping';
import { IconCheck } from '../icons';
import { generateId } from '../utils/id-generator';
import { isKeyboardModality } from '../utils/input-modality';
import { onHover } from '../utils/tooltip';
import { twMerge } from '../utils/tw';
import { COLOR_PRESETS, COLOR_PRESETS_DARK } from './color-presets';
import type { ColorPreset } from './color-presets';

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
   * target's currently-applied color (a checkmark on the matching row)
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
   * Reset the picker for its next open: clear all active colors and re-read
   * the recently used row.
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
 * The sample letter on a text tile. Drawn by CSS, not as text: real text would
 * count as the button's visible label and no longer match its aria-label.
 */
const TILE_LETTER_CLASS = "before:content-['A']";

/**
 * localStorage key holding recently used colors, shared by every picker
 * instance (marker, table cells, block settings).
 */
const RECENT_COLORS_STORAGE_KEY = 'blok-recent-colors';

/**
 * Maximum number of entries in the "Recently used" section.
 */
const RECENT_COLORS_LIMIT = 8;

/**
 * The background column's title. The mode's own label ("Background") stays the
 * word that swatch labels and slash entries are composed from.
 */
const BACKGROUND_TITLE_KEY = 'tools.colorPicker.backgroundColor';

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
 * Shared picker for inline, block and table colors: a row of recently used
 * tiles over two columns of named colors.
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
  // The popover pads its content 6px. 2px more makes the 8px the rows are spaced for.
  wrapper.className = 'grid w-76 grid-cols-2 gap-x-5.25 gap-y-2.5 p-0.5 mobile:w-full';
  const pickerId = generateId('blok-color-picker-');
  const sectionGrids: HTMLDivElement[] = [];

  const sectionClassName = 'flex min-w-0 flex-col gap-1';
  /**
   * A line in the middle of the column gap. Without it a row's checkmark
   * reads as the mark of the next column's tile.
   */
  const columnLineClassName = "relative after:absolute after:inset-y-0 after:-end-2.75 after:w-px after:bg-popover-border after:content-['']";
  const titleClassName = 'text-xs font-medium text-text-secondary px-0.5';
  const focusRingClassName = 'ring-inset focus-visible:ring-2 focus-visible:ring-focus-ring';

  /**
   * -ml-1 puts the tile on the title's left edge; the hover fill hangs past it.
   */
  const rowClassName = twMerge(
    '-ml-1 flex h-7 w-[calc(100%+0.25rem)] items-center gap-2 px-1.5 text-left',
    'rounded-(--blok-radius-control) cursor-pointer border-none outline-hidden bg-transparent',
    'hover:bg-item-hover-bg active:bg-swatch-ring-hover',
    focusRingClassName,
    'transition-colors duration-150 motion-reduce:transition-none'
  );
  const rowTileClassName = twMerge(
    'flex size-5 shrink-0 items-center justify-center rounded-(--blok-radius-control-sm)',
    'text-[13px] leading-none font-semibold'
  );
  const rowNameClassName = 'min-w-0 flex-1 truncate text-sm font-normal text-text-primary';
  // 2.25 on the icon's 20-unit box is about 1.6px here, the weight of the name beside it.
  const rowCheckClassName = 'flex size-3.5 shrink-0 text-text-primary [&>svg]:size-full [&_path]:stroke-[2.25]';

  /**
   * The tile fills its button's width, so the hover fill is a wider layer under it.
   */
  const recentClassName = twMerge(
    'relative flex h-8.5 w-7 shrink-0 items-center justify-center p-0',
    'rounded-(--blok-radius-control-lg) cursor-pointer border-none outline-hidden bg-transparent',
    "before:absolute before:inset-y-0 before:-inset-x-0.75 before:content-['']",
    'before:rounded-(--blok-radius-control-lg) before:transition-colors before:duration-150',
    'hover:before:bg-item-hover-bg active:before:bg-swatch-ring-hover motion-reduce:before:transition-none',
    focusRingClassName
  );
  const recentTileClassName = twMerge(
    'relative flex size-7 items-center justify-center rounded-(--blok-radius-control)',
    'text-base leading-none font-semibold'
  );

  /**
   * Paint a tile: a colored letter on the popover surface for text, a fill
   * edged in its own hue for background.
   */
  const paintTile = (tile: HTMLElement, field: 'text' | 'bg', preset: ColorPreset | null): void => {
    const ink = preset?.text ?? 'var(--blok-text-primary)';
    const style = tile.style;

    tile.setAttribute('aria-hidden', 'true');

    if (field === 'text') {
      tile.classList.add(TILE_LETTER_CLASS);
      style.color = ink;
      style.backgroundColor = 'var(--blok-popover-bg)';
      style.boxShadow = 'inset 0 0 0 1px var(--blok-swatch-ring-hover)';

      return;
    }

    style.backgroundColor = preset?.bg ?? SWATCH_NEUTRAL_BG;
    // The pale fills need an edge to read on the popover.
    style.boxShadow = `inset 0 0 0 1px color-mix(in srgb, ${ink} 30%, transparent)`;
  };

  const recentSectionHost = document.createElement('div');

  recentSectionHost.className = 'col-span-2';

  /**
   * Render (or clear) the "Recently used" section from localStorage. Entries
   * whose axis has no matching mode in this picker are skipped.
   */
  const renderRecentSection = (): void => {
    recentSectionHost.replaceChildren();
    // An empty grid child would still take a row gap. Hide it.
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
    section.className = sectionClassName;

    const title = document.createElement('div');

    title.className = titleClassName;
    title.setAttribute('data-blok-testid', `${testIdPrefix}-title`);
    title.textContent = i18n.t(RECENTLY_USED_LABEL_KEY);

    const grid = document.createElement('div');

    // 8 tiles of 1.75rem fill the row: the gap is what is left, split in 7.
    grid.className = 'flex gap-[calc((100%-14rem)/7)] px-0.5';

    for (const { entry, mode, preset } of recents) {
      if (mode === undefined || preset === undefined) {
        continue;
      }

      const swatch = document.createElement('button');
      const tile = document.createElement('span');
      const swatchColor = entry.field === 'text' ? preset.text : preset.bg;
      const label = formatSwatchLabel(i18n, mode.labelKey, entry.name);

      swatch.setAttribute('data-blok-testid', `${testIdPrefix}-swatch-recent-${entry.field}-${entry.name}`);
      swatch.type = 'button';
      swatch.className = recentClassName;
      // No aria-pressed here: recents never show the checkmark.
      swatch.setAttribute('aria-label', label);
      tile.className = recentTileClassName;
      tile.setAttribute('data-blok-testid', `${testIdPrefix}-tile`);
      paintTile(tile, entry.field, preset);
      swatch.appendChild(tile);

      swatch.addEventListener('click', () => {
        recordRecentColor(entry);
        onColorSelect(swatchColor, mode.key);
      });
      onHover(swatch, label, { placement: 'top' });
      grid.appendChild(swatch);
    }

    section.appendChild(title);
    section.appendChild(grid);
    recentSectionHost.appendChild(section);
    recentSectionHost.hidden = false;
  };

  // Recents lead, like Notion; the columns follow.
  wrapper.appendChild(recentSectionHost);

  modes.forEach((mode, modeIndex) => {
    const section = document.createElement('div');
    const title = document.createElement('div');
    const grid = document.createElement('div');

    title.id = `${pickerId}-title-${modeIndex}`;
    title.className = titleClassName;
    title.setAttribute('data-blok-testid', `${testIdPrefix}-title`);
    title.textContent = i18n.t(mode.presetField === 'bg' ? BACKGROUND_TITLE_KEY : mode.labelKey);

    section.setAttribute('data-blok-testid', `${testIdPrefix}-section-${mode.key}`);
    section.setAttribute('role', 'group');
    section.setAttribute('aria-labelledby', title.id);
    section.className = modeIndex === 0 ? twMerge(sectionClassName, columnLineClassName) : sectionClassName;

    grid.className = 'flex flex-col';
    sectionGrids.push(grid);
    section.append(title, grid);
    wrapper.appendChild(section);
  });

  /**
   * Build one named row: tile, name, checkmark.
   */
  const createRow = (mode: ColorPickerMode, presetName: string | null): HTMLButtonElement => {
    const row = document.createElement('button');
    const tile = document.createElement('span');
    const name = document.createElement('span');
    const check = document.createElement('span');

    row.type = 'button';
    row.className = rowClassName;
    tile.className = rowTileClassName;
    tile.setAttribute('data-blok-testid', `${testIdPrefix}-tile`);
    name.className = rowNameClassName;
    name.setAttribute('data-blok-testid', `${testIdPrefix}-name`);
    name.textContent = presetName === null ? i18n.t('tools.marker.default') : i18n.t('tools.colorPicker.color.' + presetName);
    check.className = rowCheckClassName;
    check.setAttribute('data-blok-testid', `${testIdPrefix}-check`);
    check.innerHTML = IconCheck;
    row.append(tile, name, check);

    // Recents are not re-rendered here: the row must not shuffle under the pointer.
    row.addEventListener('click', () => {
      const currentPreset = getActivePresets().find((entry) => entry.name === presetName);

      if (currentPreset) {
        recordRecentColor({ name: currentPreset.name, field: mode.presetField });
      }
      onColorSelect(currentPreset?.[mode.presetField] ?? null, mode.key);
    });

    return row;
  };

  /**
   * Render the rows for one column.
   */
  const renderSection = (modeIndex: number): void => {
    const grid = sectionGrids[modeIndex];
    const mode = modes[modeIndex];
    const presets = getActivePresets();

    const activeColor = state.activeColors[mode.key];

    [null, ...presets].forEach((preset, index) => {
      // Keep the buttons mounted: callers update selection during their click callback.
      const existing = grid.children[index];
      const row = existing instanceof HTMLButtonElement ? existing : createRow(mode, preset?.name ?? null);
      const [tile, , check] = Array.from(row.children);
      const swatchColor = preset?.[mode.presetField] ?? null;
      const isActive = swatchColor === null ? activeColor === null : activeColor !== null && colorsEqual(swatchColor, activeColor);

      row.setAttribute('data-blok-testid', `${testIdPrefix}-swatch-${mode.key}-${preset?.name ?? 'default'}`);
      row.setAttribute('aria-label', formatSwatchLabel(i18n, mode.labelKey, preset?.name ?? null));
      row.setAttribute('aria-pressed', String(isActive));

      if (tile instanceof HTMLElement && check instanceof HTMLElement) {
        paintTile(tile, mode.presetField, preset);
        check.hidden = !isActive;
      }

      if (existing === undefined) {
        grid.appendChild(row);
      }
    });
  };

  const renderAll = (): void => {
    modes.forEach((_, i) => renderSection(i));
  };

  /**
   * Arrow keys: up and down a column, across to the other column, and through
   * the recent tiles above them.
   */
  const onArrowKey = (event: KeyboardEvent): void => {
    const focused = event.target instanceof Element ? event.target.closest('button') : null;
    const recentButtons = Array.from(recentSectionHost.querySelectorAll('button'));
    const columns = sectionGrids.map((grid) => Array.from(grid.querySelectorAll('button')));
    const recentIndex = focused === null ? -1 : recentButtons.indexOf(focused);
    const columnIndex = columns.findIndex((column) => focused !== null && column.includes(focused));

    if (focused === null || (recentIndex === -1 && columnIndex === -1)) {
      return;
    }

    const rowIndex = columnIndex === -1 ? -1 : columns[columnIndex].indexOf(focused);
    const targets: Record<string, HTMLButtonElement | undefined> = recentIndex !== -1
      ? {
        ArrowLeft: recentButtons[recentIndex - 1],
        ArrowRight: recentButtons[recentIndex + 1],
        // The left half of the row sits over the first column, the right half over the second.
        ArrowDown: columns[Math.min(columns.length - 1, Math.floor(recentIndex / (RECENT_COLORS_LIMIT / columns.length)))]?.[0],
      }
      : {
        ArrowLeft: columns[columnIndex - 1]?.[rowIndex],
        ArrowRight: columns[columnIndex + 1]?.[rowIndex],
        ArrowDown: columns[columnIndex][rowIndex + 1],
        ArrowUp: rowIndex === 0
          ? recentButtons[Math.min(recentButtons.length - 1, columnIndex * (RECENT_COLORS_LIMIT / columns.length))]
          : columns[columnIndex][rowIndex - 1],
      };

    if (!(event.key in targets)) {
      return;
    }

    // The arrows belong to the picker even at an edge: the page must not scroll.
    event.preventDefault();
    event.stopPropagation();
    targets[event.key]?.focus({ preventScroll: true });
  };

  wrapper.addEventListener('keydown', onArrowKey);

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
      renderRecentSection();
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
