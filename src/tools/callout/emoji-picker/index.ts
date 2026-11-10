// src/tools/callout/emoji-picker/index.ts

import { loadEmojiData, loadEmojiGrid, groupEmojisByCategory, CURATED_CALLOUT_EMOJIS, type ProcessedEmoji } from '../../../components/utils/emoji/emoji-data';
import { searchEmojisRanked } from '../../../components/utils/emoji/emoji-search-ranked';
import { loadEmojiLocale, type EmojiLocaleData } from '../../../components/utils/emoji/emoji-locale';
import { prefetchEmojiPickerData } from '../../../components/utils/emoji/emoji-prefetch';
import { hide as hideTooltip, onHover } from '../../../components/utils/tooltip';
import { DATA_ATTR } from '../../../components/constants';
import { emojiColor } from '../../../components/utils/emoji/emoji-color';
import { getElementDirection, logicalArrow } from '../../../components/utils/direction';
import { syncPortalDirection } from '../../../components/utils/portal-direction';
import { getTabbables } from '../../../components/utils/modal-dialog';
import { createPositionTracker, type PositionTracker } from '../../../components/utils/popover/anchored-position';
import {
  REMOVE_EMOJI_KEY, FILTER_EMOJIS_KEY, CALLOUT_EMOJI_CATEGORY_KEY, NO_EMOJIS_FOUND_KEY, EMOJI_SEARCH_RESULTS_KEY, PICK_RANDOM_KEY, SKIN_TONE_KEY,
  EDIT_ICON_KEY, EMOJI_CHIP_PEOPLE_KEY, EMOJI_CHIP_NATURE_KEY, EMOJI_CHIP_FOOD_KEY, EMOJI_CHIP_TRAVEL_KEY,
  RECENT_EMOJIS_KEY, CURRENT_ICON_KEY, NO_ICON_YET_KEY, PICK_ICON_KEY,
  EMOJI_CATEGORY_PEOPLE_KEY, EMOJI_CATEGORY_NATURE_KEY, EMOJI_CATEGORY_FOOD_KEY, EMOJI_CATEGORY_ACTIVITY_KEY,
  EMOJI_CATEGORY_TRAVEL_KEY, EMOJI_CATEGORY_OBJECTS_KEY, EMOJI_CATEGORY_SYMBOLS_KEY, EMOJI_CATEGORY_FLAGS_KEY,
} from '../constants';

/** Maps emoji-mart category IDs to their i18n key. */
const CATEGORY_I18N_KEYS: Readonly<Record<string, string>> = {
  callout: CALLOUT_EMOJI_CATEGORY_KEY,
  people: EMOJI_CATEGORY_PEOPLE_KEY,
  nature: EMOJI_CATEGORY_NATURE_KEY,
  foods: EMOJI_CATEGORY_FOOD_KEY,
  activity: EMOJI_CATEGORY_ACTIVITY_KEY,
  places: EMOJI_CATEGORY_TRAVEL_KEY,
  objects: EMOJI_CATEGORY_OBJECTS_KEY,
  symbols: EMOJI_CATEGORY_SYMBOLS_KEY,
  flags: EMOJI_CATEGORY_FLAGS_KEY,
};
import {
  IconCross,
  IconTrash,
  IconEmojiDice,
  IconEmojiNavSparkles,
  IconEmojiNavSmile,
  IconEmojiNavCat,
  IconEmojiNavBurger,
  IconEmojiNavBall,
  IconEmojiNavCar,
  IconEmojiNavBulb,
  IconEmojiNavHeart,
  IconEmojiNavFlag,
} from '../../../components/icons';

interface I18n {
  t: (key: string) => string;
}

interface EmojiPickerOptions {
  /** `origin` is the picked glyph's rect, so the host can animate from it. */
  onSelect: (native: string, origin?: DOMRect) => void;
  onRemove: () => void;
  i18n: I18n;
  locale: string;
  /**
   * Renders the same picker anchored inside a contentEditable, for the inline
   * ":" trigger: `open()` does not steal focus, skips the page backdrop and
   * scroll lock, and leaves Escape to the caller (who already owns it).
   * Defaults to false, the Callout icon-editing popover's existing behaviour.
   */
  inline?: boolean;
  /**
   * Shows the curated Callout section first. Defaults to on, except in inline
   * mode. Pickers that do not edit a callout (a page icon) turn it off.
   */
  curated?: boolean;
  /** How far the picker starts before the anchor's start edge, in px. Defaults to 8. */
  startInset?: number;
  /** No Random and no Remove: the pick is the whole job, as for a reaction. */
  pickOnly?: boolean;
  /** The dialog's name. Defaults to "Edit icon". */
  label?: string;
}

const UNCAPPED_RESULTS = Number.POSITIVE_INFINITY;

/** The inline ":" menu shows up to this many matches as one block, with no category names and no bar. */
const INLINE_FLAT_MAX = 30;
/** Icon and short chip label for each emoji category (display order). */
const CATEGORY_NAV: ReadonlyArray<readonly [id: string, icon: string, chipKey?: string]> = [
  ['callout', IconEmojiNavSparkles],
  ['people', IconEmojiNavSmile, EMOJI_CHIP_PEOPLE_KEY],
  ['nature', IconEmojiNavCat, EMOJI_CHIP_NATURE_KEY],
  ['foods', IconEmojiNavBurger, EMOJI_CHIP_FOOD_KEY],
  ['activity', IconEmojiNavBall],
  ['places', IconEmojiNavCar, EMOJI_CHIP_TRAVEL_KEY],
  ['objects', IconEmojiNavBulb],
  ['symbols', IconEmojiNavHeart],
  ['flags', IconEmojiNavFlag],
];

const RECENT_STORAGE_KEY = 'blok-emoji-recent';
/** One grid row. */
const RECENT_LIMIT = 10;

function loadRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_STORAGE_KEY) ?? '[]');

    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveRecent(list: string[]): void {
  try {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Storage full or blocked: the row simply does not persist.
  }
}

/** Swatch colour of each skin tone (default + 5 Fitzpatrick modifiers), for the dial and the toggle dot. */
const SKIN_TONE_COLORS: readonly string[] = ['#ffcc4d', '#f7dece', '#f3d2a2', '#d5ab88', '#af7e57', '#7c533e'];

/**
 * The skin-tone dial: a half ring hanging under the toggle, in its own 140×88 box.
 * Must match the box in emoji-picker.css. The centre sits 16px under the box top,
 * so the ring opens just below the toggle.
 */
const SKIN_DIAL = { cx: 70, cy: 16, inner: 30, outer: 62, chosen: 5, hover: 2.5, gap: 1, rim: 2, span: Math.PI * 0.176 } as const;
const skinToneAngle = (index: number): number => Math.PI * (0.94 - index * 0.176);
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

/** The box around a segment at its largest (chosen) reach, in dial-box pixels. */
const skinSegmentBox = (index: number): { x: number; y: number; width: number; height: number } => {
  const { cx, cy, inner, outer, chosen, span } = SKIN_DIAL;
  const mid = skinToneAngle(index);
  const points = [inner, outer + chosen].flatMap(radius => Array.from({ length: 9 }, (_, k) => {
    const angle = mid - span / 2 + span * (k / 8);

    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  }));
  const x = Math.floor(Math.min(...points.map(point => point.x)));
  const y = Math.floor(Math.min(...points.map(point => point.y)));

  return {
    x,
    y,
    width: Math.ceil(Math.max(...points.map(point => point.x))) - x,
    height: Math.ceil(Math.max(...points.map(point => point.y))) - y,
  };
};
const SKIN_SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const SKIN_FOLD = 'cubic-bezier(0.6, 0, 0.4, 1)';
/** The landing circle's box reaches this far above the dial box, up to the toggle. */
const SKIN_BLOB_TOP = 60;

const SKIN_TONE_STORAGE_KEY = 'blok-emoji-skin-tone';

function loadSkinTone(): number {
  try {
    const raw = localStorage.getItem(SKIN_TONE_STORAGE_KEY);

    if (raw === null) {
      return 0;
    }

    const n = parseInt(raw, 10);

    return n >= 0 && n <= 5 ? n : 0;
  } catch {
    return 0;
  }
}

function saveSkinTone(index: number): void {
  try {
    localStorage.setItem(SKIN_TONE_STORAGE_KEY, String(index));
  } catch {
    // Silently ignore — storage quota or access denied
  }
}

/** Dice SVG for the random button. */
const ICON_DICE = IconEmojiDice;

export { prefetchEmojiPickerData };

/**
 * Public warm-up for hosts, exported from `@bloklabs/core/tools`. Signature is
 * hand-mirrored in `types/tools-entry.d.ts`.
 * @param locale - Blok locale code; defaults to English
 */
export function preloadEmojiData(locale = 'en'): void {
  prefetchEmojiPickerData(locale);
}

export class EmojiPicker {
  private onSelect: (native: string, origin?: DOMRect) => void;
  private onRemove: () => void;
  private readonly i18n: I18n;
  private readonly _locale: string;
  private readonly _inline: boolean;
  private readonly _curated: boolean;
  private readonly _startInset: number;
  private readonly _pickOnly: boolean;
  private readonly _label: string | undefined;
  private _localeData: EmojiLocaleData | null = null;
  private _localeLoad: Promise<void> | null = null;
  private _hasKeywords = false;
  private _keywordsLoad: Promise<void> | null = null;
  /** Caret rect override for inline mode — see `open()`'s `anchorRect` param. */
  private _anchorRectOverride: DOMRect | null = null;

  private _element: HTMLElement;
  private _body: HTMLElement;
  private _nav: HTMLElement;
  private _filterInput!: HTMLInputElement;
  private _announcer: HTMLElement;
  private _clearSearchButton!: HTMLButtonElement;
  private _stage: HTMLElement | null = null;
  /** What the stage shows now; null before its first paint. */
  private _stageGlyph: string | null = null;
  /** The host's current emoji, shown on the stage while nothing is pointed at. */
  private _current = '';
  /** Natives the rendered Recent row holds, to know when a reopen must rebuild it. */
  private _renderedRecent = '';
  private _byNative = new Map<string, ProcessedEmoji>();
  private _open = false;
  private _allEmojis: ProcessedEmoji[] = [];
  private _skinTone = 0;
  private _showingEmptyState = false;
  /**
   * Whether the body currently holds the complete, unfiltered grid. Rebuilding
   * it costs ~40ms of element creation plus two forced layouts over ~1900
   * nodes, and a reopen asks for the exact same markup — so when this is true
   * the grid is reused as-is.
   */
  private _hasFullGrid = false;

  private _anchorEl: HTMLElement | null = null;
  private _previouslyFocused: HTMLElement | null = null;
  private _backdrop: HTMLElement | null = null;
  private _savedOverflow = '';
  private _positionTracker: PositionTracker | null = null;

  /** Maps category id -> nav button for active-state management. */
  private _navButtons = new Map<string, HTMLButtonElement>();
  /** Maps category id -> section element for scroll targeting. */
  private _sectionEls = new Map<string, HTMLElement>();
  /** Currently highlighted category in the nav bar. */
  private _activeNavId = '';
  private _scrollDestination: number | null = null;
  /** rAF handle for scroll-based nav updates. */
  private _navRafId = 0;
  private _emojiButtons: HTMLButtonElement[] = [];
  private _focusedEmoji: HTMLButtonElement | null = null;
  /** Bound capture-phase Escape handler, registered on `document` while open. */
  private _onDocumentKeydown: (e: KeyboardEvent) => void;
  /** Skin tone selector buttons for visual updates. */
  private _skinToneButtons: HTMLButtonElement[] = [];
  private _skinToneToggle!: HTMLButtonElement;
  private _skinTonePopover!: HTMLElement;
  private _skinToneCloseAnimation: Animation | null = null;
  /** Every running dial animation and timer, so a close or reopen can stop them all. */
  private _skinToneAnimations = new Set<Animation>();
  private _skinToneTimers = new Set<number>();
  /** A chosen tone whose dot and grid repaint waits for the landing circle. */
  private _skinTonePending = false;

  constructor(options: EmojiPickerOptions) {
    this.onSelect = options.onSelect;
    this.onRemove = options.onRemove;
    this.i18n = options.i18n;
    this._locale = options.locale;
    this._inline = options.inline ?? false;
    this._curated = options.curated ?? !this._inline;
    this._startInset = options.startInset ?? 8;
    this._pickOnly = options.pickOnly ?? false;
    this._label = options.label;
    this._element = this.buildElement();

    const body = this._element.querySelector<HTMLElement>('[data-emoji-picker-body]');
    const nav = this._element.querySelector<HTMLElement>('[data-emoji-picker-nav]');
    const announcer = this._element.querySelector<HTMLElement>('[data-emoji-picker-announcer]');

    if (body === null || nav === null || announcer === null) {
      throw new Error('EmojiPicker: failed to build required elements');
    }

    this._body = body;
    this._nav = nav;
    this._announcer = announcer;

    this._onDocumentKeydown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || !this._open) {
        return;
      }

      // Skin-tone popover intercepts Escape first, keeping the picker open.
      if (!this._skinTonePopover.hidden && this._skinToneCloseAnimation === null) {
        this.closeSkinTonePopover();
      } else {
        this.close();
      }
    };

    this._body.addEventListener('scroll', () => this.scheduleScrollEffects(), { passive: true });

    const resumeScrollTracking = (): void => {
      this._scrollDestination = null;
      this.scheduleScrollEffects();
    };

    for (const type of ['wheel', 'touchstart', 'pointerdown']) {
      this._body.addEventListener(type, resumeScrollTracking, { passive: true });
    }

    this._element.addEventListener('keydown', (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Tab'].includes(event.key)) {
        resumeScrollTracking();
      }
    });
  }

  public getElement(): HTMLElement {
    return this._element;
  }

  public isOpen(): boolean {
    return this._open;
  }

  /**
   * @param anchor - element the picker is positioned against
   * @param anchorRect - overrides `anchor`'s own bounding rect for positioning
   * (inline mode: the anchor is the block's contentEditable, but the true
   * anchor point is the ":" character's rect inside it)
   * @param handlers - replaces the constructor's callbacks, for a picker shared by several blocks
   */
  public async open(
    anchor: HTMLElement,
    anchorRect?: DOMRect,
    handlers?: Pick<EmojiPickerOptions, 'onSelect' | 'onRemove'> & { current?: string }
  ): Promise<void> {
    const active = document.activeElement;

    if (handlers !== undefined) {
      this.onSelect = handlers.onSelect;
      this.onRemove = handlers.onRemove;
    }

    this._current = handlers?.current ?? '';

    // Focus inside the picker means it is being reopened for another anchor:
    // close() must then fall back to that anchor, not to the hidden picker.
    this._previouslyFocused = active instanceof HTMLElement && active !== document.body && !this._element.contains(active)
      ? active
      : null;
    this._anchorEl = anchor;
    this._anchorRectOverride = anchorRect ?? null;
    this._open = true;
    this._scrollDestination = null;
    this._filterInput.value = '';
    this._clearSearchButton.hidden = true;
    this._element.setAttribute('data-theme', this.resolveTheme());
    // One picker serves every callout and editor, so re-read the direction on each open.
    syncPortalDirection(this._element, { source: anchor, onResync: () => this.onDirectionResync() });

    const storedTone = loadSkinTone();
    const toneChanged = storedTone !== this._skinTone;

    if (toneChanged) {
      this._skinTone = storedTone;
      this.paintSkinToneToggle();
      this.syncSkinToneSegments();
    }

    // Chained before the dataset await on purpose: a cached locale's callback
    // then runs first, so the first render is already localized.
    if (this._locale !== 'en' && this._localeData === null && this._localeLoad === null) {
      this._localeLoad = loadEmojiLocale(this._locale).then(localeData => {
        this._localeLoad = null;

        if (localeData !== null) {
          this._localeData = localeData;
          this.applyLocaleToGrid();
        }
      });
    }

    if (this._allEmojis.length === 0) {
      this._allEmojis = await loadEmojiGrid();
    }
    if (!this._open) return;

    if (this._hasFullGrid && this._renderedRecent !== this.recentEmojis().map(emoji => emoji.native).join(' ')) {
      this._hasFullGrid = false;
    }

    this.showStageIdle();

    if (this._hasFullGrid) {
      // Identical markup to what a rebuild would produce — only the tone (which
      // another picker instance may have changed) and the scroll offset drift.
      if (toneChanged) {
        this.applySkinToneToGrid();
      }

      this.setNavHidden(false);
      this._body.scrollTop = 0;
      this.scheduleScrollEffects();
    } else {
      this.renderEmojiGrid(this._allEmojis);
    }

    if (!this._inline) {
      // Inline mode must not block pointer/scroll on the rest of the page —
      // the caret has to stay usable while the picker is open.
      this.showBackdrop();
    }

    // Unhide before positioning so getBoundingClientRect returns real dimensions
    this._element.style.animation = 'none';
    this._element.hidden = false;
    this.position(anchor);
    this.measureCell();
    this._positionTracker?.detach();
    this._positionTracker = createPositionTracker(this._element, (event) => {
      if (event?.target === this._body) {
        return;
      }

      if (this._open && this._anchorEl !== null) {
        this.position(this._anchorEl);

        if (event === undefined) {
          this.measureCell();
          this.scheduleScrollEffects();
        }
      }
    });
    this._positionTracker.attach();

    // Replay the opening animation
    this._element.offsetHeight;
    this._element.style.animation = '';

    if (!this._inline) {
      // Capture-phase Escape so it closes the picker before any bubbling
      // handler. Inline mode's caller already owns Escape (and Tab/arrows),
      // so a second capture-phase listener here would race it.
      document.addEventListener('keydown', this._onDocumentKeydown, true);
      this._filterInput.focus();
    }

    this.loadKeywords();
  }

  /**
   * Keywords come in a separate, larger file than the grid. Started after the
   * grid is shown so they are usually in before the user types; until then
   * search matches names and ids only.
   */
  private loadKeywords(): void {
    if (this._hasKeywords || this._keywordsLoad !== null) {
      return;
    }

    this._keywordsLoad = loadEmojiData()
      .then(emojis => {
        this._hasKeywords = true;
        this._allEmojis = emojis;
        this._byNative.clear();
        this.refilterWhileTyping();
      })
      .catch(() => undefined)
      .finally(() => {
        this._keywordsLoad = null;
      });
  }

  /**
   * Re-places the open picker for the new direction. Inline mode reuses the
   * caret rect captured on open. Closing here instead would desync the ":"
   * trigger, which owns the inline picker's open state.
   */
  private onDirectionResync(): void {
    if (this._open && this._anchorEl !== null) {
      this.position(this._anchorEl);
    }
  }

  public close(): void {
    this._open = false;
    this._scrollDestination = null;
    cancelAnimationFrame(this._navRafId);
    this._navRafId = 0;
    this._positionTracker?.detach();
    this._positionTracker = null;

    /**
     * Every control in here owns a hover tooltip on the shared singleton.
     * Hiding the root takes their layout boxes away, so the bubble has to go
     * with them — otherwise it outlives the picker anchored to an element
     * that no longer renders.
     */
    hideTooltip();
    this._element.hidden = true;
    document.removeEventListener('keydown', this._onDocumentKeydown, true);
    this.closeSkinTonePopover();
    this.removeBackdrop();
    this._announcer.textContent = '';

    if (this._inline) {
      // Focus was never taken from the caret (see open()), so there is
      // nothing to give back — re-focusing here could disturb the caret.
      this._previouslyFocused = null;

      return;
    }

    // Restore focus to whatever was focused before opening; fall back to the
    // anchor when that element has since left the document.
    const restoreTarget = this._previouslyFocused?.isConnected === true
      ? this._previouslyFocused
      : this._anchorEl;

    this._previouslyFocused = null;
    restoreTarget?.focus();
  }

  // ─── DOM Construction ─────────────────────────────────────

  private buildElement(): HTMLElement {
    const el = document.createElement('div');

    el.setAttribute('data-blok-emoji-picker', '');
    el.toggleAttribute('data-emoji-picker-inline', this._inline);
    // The picker mounts on document.body (callout/index.ts), OUTSIDE Blok's
    // interface roots. Blok's compiled Tailwind utilities are scoped to only
    // match inside [data-blok-interface]/[data-blok-popover] (see
    // scripts/scope-utilities), so mark this popover root — otherwise its
    // sizing utilities (w-[400px], fixed, …) never apply and its anchored
    // position collapses.
    el.setAttribute('data-blok-popover', '');

    if (!this._inline) {
      el.setAttribute(DATA_ATTR.keyboardOwner, '');
      // Inline mode isn't a modal dialog — it's a suggestion menu anchored in
      // a contentEditable, and the composer that owns it sets its own id/role.
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-label', this._label ?? this.i18n.t(EDIT_ICON_KEY));
    }

    el.className = [
      'fixed z-50 w-[400px] overflow-hidden',
      'border border-neutral-200/70 bg-white shadow-2xl',
      'theme-dark:border-neutral-700/50 theme-dark:bg-neutral-900',
    ].join(' ');
    el.hidden = true;

    // Header: search input + random button + remove button
    const header = document.createElement('div');

    header.setAttribute('data-emoji-picker-header', '');
    header.className = 'flex items-center gap-2.5 px-3 pt-3 pb-2';

    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'flex-1 min-w-0';
    searchWrapper.setAttribute('data-emoji-picker-search', '');
    // The field draws the box and the search glyph; see field.css.
    searchWrapper.setAttribute('data-blok-field', 'search');

    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('role', 'searchbox');
    input.setAttribute('aria-label', this.i18n.t(FILTER_EMOJIS_KEY));
    input.placeholder = this.i18n.t(FILTER_EMOJIS_KEY);
    input.addEventListener('input', () => this.handleFilterChange(input.value));
    this._filterInput = input;

    searchWrapper.appendChild(input);

    const clearSearch = document.createElement('button');

    clearSearch.type = 'button';
    clearSearch.hidden = true;
    clearSearch.setAttribute('data-emoji-picker-clear', '');
    clearSearch.setAttribute('aria-label', this.i18n.t('tools.callout.clearEmojiSearch'));
    clearSearch.innerHTML = IconCross;
    clearSearch.addEventListener('click', () => {
      this.setQuery('');
      input.focus();
    });
    searchWrapper.appendChild(clearSearch);
    this._clearSearchButton = clearSearch;

    // Skin tone hand toggle (separate button next to search input)
    const skinToneWrapper = document.createElement('div');

    skinToneWrapper.className = 'relative flex-shrink-0';

    const skinToggle = document.createElement('button');

    skinToggle.type = 'button';
    skinToggle.setAttribute('data-emoji-picker-skin-toggle', '');
    skinToggle.setAttribute('aria-label', this.i18n.t(SKIN_TONE_KEY));
    skinToggle.setAttribute('aria-expanded', 'false');
    skinToggle.title = this.i18n.t(SKIN_TONE_KEY);
    skinToggle.className = [
      'w-[28px] h-[28px] flex items-center justify-center',
      'text-[14px] leading-none cursor-pointer select-none',
      'hover:bg-neutral-100 theme-dark:hover:bg-neutral-800',
      'active:scale-90 transition-all duration-100',
    ].join(' ');
    const dot = document.createElement('span');

    dot.setAttribute('data-emoji-skin-dot', '');
    dot.setAttribute('aria-hidden', 'true');
    skinToggle.appendChild(dot);
    skinToggle.addEventListener('click', () => this.toggleSkinTonePopover());
    this._skinToneToggle = skinToggle;
    this.paintSkinToneToggle();
    skinToneWrapper.appendChild(skinToggle);

    // Skin tone popover (hidden by default, anchored below toggle)
    this._skinTonePopover = this.buildSkinTonePopover();
    skinToneWrapper.appendChild(this._skinTonePopover);

    // Random button
    const randomBtn = document.createElement('button');
    randomBtn.type = 'button';
    randomBtn.setAttribute('data-emoji-picker-random', '');
    randomBtn.setAttribute('aria-label', this.i18n.t(PICK_RANDOM_KEY));
    randomBtn.className = [
      'flex-shrink-0 w-[34px] h-[34px] flex items-center justify-center',
      'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600',
      'theme-dark:hover:bg-neutral-800 theme-dark:hover:text-neutral-300',
      'transition-colors duration-100 cursor-pointer',
    ].join(' ');
    randomBtn.innerHTML = ICON_DICE;
    randomBtn.addEventListener('click', () => this.pickRandom());
    onHover(randomBtn, this.i18n.t(PICK_RANDOM_KEY), { placement: 'bottom' });

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.setAttribute('data-emoji-picker-remove', '');
    removeBtn.setAttribute('aria-label', this.i18n.t(REMOVE_EMOJI_KEY));
    removeBtn.className = [
      'flex-shrink-0 w-[34px] h-[34px] flex items-center justify-center',
      'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600',
      'theme-dark:hover:bg-neutral-800 theme-dark:hover:text-neutral-300',
      'transition-colors duration-100 cursor-pointer',
    ].join(' ');
    removeBtn.innerHTML = IconTrash;
    removeBtn.addEventListener('click', () => {
      this.onRemove();
      this.close();
    });
    onHover(removeBtn, this.i18n.t(REMOVE_EMOJI_KEY), { placement: 'bottom' });

    const actionGroup = document.createElement('div');
    actionGroup.className = 'flex items-center gap-1';
    actionGroup.appendChild(randomBtn);
    actionGroup.appendChild(removeBtn);

    header.appendChild(searchWrapper);
    header.appendChild(skinToneWrapper);
    if (!this._pickOnly) {
      header.appendChild(actionGroup);
    }

    // The inline menu has no header: the typed ":query" is its search field,
    // there is no chosen emoji to reroll or remove, and the skin tone comes
    // from the stored choice.
    if (!this._inline) {
      el.appendChild(header);
    }

    const body = document.createElement('div');
    body.setAttribute('data-emoji-picker-body', '');
    body.className = 'overflow-y-auto max-h-[260px] px-1.5 pb-2';

    const nav = document.createElement('div');
    nav.setAttribute('data-emoji-picker-nav', '');
    nav.className = [
      'flex items-center gap-1 px-2 pt-1 pb-1',
      'border-t border-neutral-100 theme-dark:border-neutral-800',
    ].join(' ');
    const footer = document.createElement('div');

    footer.setAttribute('data-emoji-picker-footer', '');
    footer.appendChild(nav);

    if (this._inline) {
      el.append(body, footer);
    } else {
      // The chips sit under the search, in DOM order too, so Tab follows what you see.
      el.append(footer, body, this.buildStage(body));
    }

    const announcer = document.createElement('div');
    announcer.setAttribute('data-emoji-picker-announcer', '');
    announcer.setAttribute('role', 'status');
    announcer.setAttribute('aria-live', 'polite');
    el.appendChild(announcer);

    // Close skin tone popover on click outside toggle/popover
    el.addEventListener('mousedown', (e: MouseEvent) => {
      const target = e.target as Node;

      // Inline controls must not take the caret from the typed query.
      if (this._inline && target instanceof Element && target.closest('button') !== null) {
        e.preventDefault();
      }

      // A dial that is already folding shut finishes its fold; a tone in flight lands at once.
      if (!this._skinTonePopover.hidden
        && this._skinToneCloseAnimation === null
        && !this._skinTonePopover.contains(target)
        && !this._skinToneToggle.contains(target)) {
        this.closeSkinTonePopover(!this._skinTonePending);
      }
    });

    // Escape is handled document-wide in the capture phase (see open()/close())
    // so it wins over other listeners even when focus is inside the picker.

    // Tab containment: the backdrop only blocks pointers, so cycle Tab /
    // Shift+Tab within the picker's tabbables while it is open.
    el.addEventListener('keydown', (e: KeyboardEvent) => {
      if (this._inline) {
        // The caret must stay in the document in inline mode (see the
        // `inline` option) — EmojiTrigger owns grid navigation externally
        // and never gives this picker real focus. But a mouse click on a
        // remaining control (skin tone toggle, category nav, a grid emoji
        // button — plain <button>s, all natively focusable) still can, and
        // a keydown from there would otherwise reach handleEmojiKeydown's
        // native-focus-based nav and this Tab trap, both wrong here.
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-deprecated -- Keep the IME 229 fallback when isComposing is false.
      if (e.isComposing || e.keyCode === 229) {
        return;
      }

      this.handleEmojiKeydown(e);

      if (e.key !== 'Tab' || !this._open) {
        return;
      }

      const tabbables = getTabbables(el);
      const first = tabbables.at(0);
      const last = tabbables.at(-1);

      if (first === undefined || last === undefined) {
        e.preventDefault();

        return;
      }

      const active = document.activeElement;

      if (e.shiftKey) {
        if (active === first || !el.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !el.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    });

    return el;
  }

  /**
   * The strip under the grid: the host's current icon at rest, or the emoji
   * under the pointer or the focus, standing on a shadow of its own colour.
   * With no icon it shows a line smiley and an invitation.
   * @param body - the grid's scroll container, whose pointer and focus it follows
   */
  private buildStage(body: HTMLElement): HTMLElement {
    const stage = document.createElement('div');
    const glyph = document.createElement('span');
    const text = document.createElement('span');
    const kicker = document.createElement('span');
    const name = document.createElement('span');

    stage.setAttribute('data-emoji-picker-stage', '');
    // The buttons carry the names; this strip only shows them again.
    stage.setAttribute('aria-hidden', 'true');
    glyph.setAttribute('data-emoji-picker-stage-glyph', '');
    text.setAttribute('data-emoji-picker-stage-text', '');
    kicker.setAttribute('data-emoji-picker-stage-kicker', '');
    name.setAttribute('data-emoji-picker-stage-name', '');
    text.append(kicker, name);
    stage.append(glyph, text);
    this._stage = stage;

    const emojiAt = (target: EventTarget | null): HTMLElement | null =>
      target instanceof Element ? target.closest<HTMLElement>('[data-emoji-native]') : null;

    body.addEventListener('pointerover', (event) => {
      const button = emojiAt(event.target);

      if (button !== null) {
        this.showOnStage(button);
      }
    });
    body.addEventListener('pointerleave', () => {
      const focused = emojiAt(document.activeElement);

      if (focused !== null && body.contains(focused)) {
        this.showOnStage(focused);
      } else {
        this.showStageIdle();
      }
    });
    body.addEventListener('focusin', (event) => {
      const button = emojiAt(event.target);

      if (button !== null) {
        this.showOnStage(button);
      }
    });
    body.addEventListener('focusout', (event) => {
      if (emojiAt(event.relatedTarget) === null) {
        this.showStageIdle();
      }
    });

    return stage;
  }

  private setStage(glyph: string, kicker: string, label: string): void {
    if (this._stage === null) {
      return;
    }

    const [glyphEl, text] = this._stage.children;
    const name = text.children[1];
    // The first paint rides the picker's own opening.
    const changed = this._stageGlyph !== null && this._stageGlyph !== glyph;

    this._stageGlyph = glyph;

    if (glyph === '') {
      glyphEl.innerHTML = IconEmojiNavSmile;
    } else {
      glyphEl.textContent = glyph;
    }

    text.children[0].textContent = kicker;
    name.textContent = label;
    this._stage.toggleAttribute('data-emoji-picker-stage-empty', glyph === '');
    this._stage.style.setProperty('--emoji-stage-wash', emojiColor(glyph) ?? 'transparent');

    const still = !this._open || !changed || typeof glyphEl.animate !== 'function'
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (still) {
      return;
    }

    // An emoji drops onto its shadow and squashes; the smiley only fades back. The shadow's colour crossfades in CSS.
    glyphEl.animate(glyph === ''
      ? [{ transform: 'scale(.8)', opacity: 0 }, { transform: 'none', opacity: 1 }]
      : [
        { transform: 'translateY(-16px) scale(.9, 1.1)', opacity: 0 },
        { transform: 'translateY(0) scale(1.12, .86)', opacity: 1, offset: 0.55 },
        { transform: 'none' },
      ], { duration: glyph === '' ? 260 : 420, easing: 'ease-out' });
    name.animate([{ transform: 'translateY(5px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 200, easing: 'ease-out' });
  }

  /** The stage names an emoji like a title: "Kissing face", not the label's "kissing face". */
  private stageName(emoji: ProcessedEmoji | undefined): string {
    const name = emoji === undefined ? '' : this.getDisplayName(emoji);

    return name.charAt(0).toLocaleUpperCase(this._locale) + name.slice(1);
  }

  private showStageIdle(): void {
    const emoji = this.emojiByNative(this._current);

    this.setStage(
      this._current,
      this.i18n.t(this._current === '' ? NO_ICON_YET_KEY : CURRENT_ICON_KEY),
      this._current === '' ? this.i18n.t(PICK_ICON_KEY) : this.stageName(emoji)
    );
  }

  private showOnStage(button: HTMLElement): void {
    const emoji = this.emojiByNative(button.getAttribute('data-emoji-native') ?? '');
    const section = button.closest('[data-emoji-section]')?.querySelector('[data-emoji-section-title] > span');

    this.setStage(
      button.firstElementChild?.textContent ?? '',
      section?.textContent ?? '',
      this.stageName(emoji)
    );
  }

  /** Finds an emoji by its base glyph or any of its skin-tone glyphs. */
  private emojiByNative(native: string): ProcessedEmoji | undefined {
    if (this._byNative.size === 0) {
      this._byNative = new Map(this._allEmojis.flatMap(emoji =>
        [emoji.native, ...emoji.skins].map(glyph => [glyph, emoji] as const)));
    }

    return this._byNative.get(native);
  }

  /** Recent picks that still exist in the data, newest first. Never in inline mode. */
  private recentEmojis(): ProcessedEmoji[] {
    if (this._inline) {
      return [];
    }

    return loadRecent()
      .map(native => this.emojiByNative(native))
      .filter((emoji): emoji is ProcessedEmoji => emoji !== undefined);
  }

  /**
   * Hands a pick to the host and remembers it for the Recent row.
   * @param emoji - the picked emoji
   * @param origin - where its glyph was on screen
   */
  private select(emoji: ProcessedEmoji, origin: DOMRect | undefined): void {
    if (!this._inline) {
      saveRecent([emoji.native, ...loadRecent().filter(native => native !== emoji.native)].slice(0, RECENT_LIMIT));
    }

    this.onSelect(this.getSkinnedNative(emoji), origin);
  }

  private handleEmojiKeydown(event: KeyboardEvent): void {
    if (!this._open) {
      return;
    }

    if (event.target === this._filterInput && event.key === 'ArrowDown') {
      if (this._emojiButtons.length > 0) {
        event.preventDefault();
        this.focusEmoji(0);
      }

      return;
    }

    const target = event.target;

    if (!(target instanceof HTMLButtonElement)) {
      return;
    }

    const index = this._emojiButtons.indexOf(target);
    const grid = target.parentElement;

    if (index < 0 || grid === null) {
      return;
    }

    const tracks = getComputedStyle(grid).gridTemplateColumns;
    const columns = tracks && tracks !== 'none' ? tracks.split(' ').length : 10;
    const steps: Record<string, number> = {
      forward: 1, backward: -1, ArrowUp: -columns, ArrowDown: columns,
      Home: -index, End: this._emojiButtons.length - 1 - index,
    };
    const step = steps[logicalArrow(event.key, getElementDirection(this._element)) ?? event.key];

    if (step === undefined) {
      return;
    }

    event.preventDefault();

    if (event.key === 'ArrowUp' && index < columns) {
      this._filterInput.focus();

      return;
    }

    this.focusEmoji(Math.max(0, Math.min(this._emojiButtons.length - 1, index + step)));
  }

  private focusEmoji(index: number): void {
    const button = this._emojiButtons[index];

    if (button === undefined) {
      return;
    }

    if (this._focusedEmoji !== null) {
      this._focusedEmoji.tabIndex = -1;
    }

    this._focusedEmoji = button;
    button.tabIndex = 0;
    button.focus({ preventScroll: true });
    button.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
  }

  // ─── Skin Tone Selector ─────────────────────────────────────

  /**
   * The skin-tone dial. Each tone is a real button clipped to its ring segment, so it
   * keeps its name, focus and keyboard order while only its segment takes clicks.
   */
  private buildSkinTonePopover(): HTMLElement {
    const popover = document.createElement('div');

    popover.setAttribute('data-emoji-picker-skin-tone', '');
    popover.hidden = true;
    popover.setAttribute('role', 'group');
    popover.setAttribute('aria-label', this.i18n.t(SKIN_TONE_KEY));
    popover.addEventListener('keydown', (event: KeyboardEvent) => {
      const target = event.target;

      if (!(target instanceof HTMLButtonElement)) {
        return;
      }

      const index = this._skinToneButtons.indexOf(target);
      const steps: Record<string, number> = { forward: 1, backward: -1 };
      const direction = steps[logicalArrow(event.key, getElementDirection(popover)) ?? ''] ?? 0;

      if (index < 0 || direction === 0) {
        return;
      }

      event.preventDefault();
      this._skinToneButtons[(index + direction + this._skinToneButtons.length) % this._skinToneButtons.length]?.focus();
    });

    this._skinToneButtons = SKIN_TONE_COLORS.map((color, index) => {
      const btn = document.createElement('button');
      const box = skinSegmentBox(index);

      btn.type = 'button';
      btn.setAttribute('aria-label', `${this.i18n.t(SKIN_TONE_KEY)} ${index + 1}`);
      // Each button covers only its own segment, so its centre (where pointer tools aim) is on the tone.
      btn.style.left = `${box.x}px`;
      btn.style.top = `${box.y}px`;
      btn.style.width = `${box.width}px`;
      btn.style.height = `${box.height}px`;
      btn.style.setProperty('transform-origin', `${SKIN_DIAL.cx - box.x}px ${SKIN_DIAL.cy - box.y}px`);
      btn.style.setProperty('--emoji-tone-color', color);
      btn.style.setProperty('--emoji-tone-shape', `path('${this.skinSegmentPath(index, 0, box)}')`);
      btn.style.setProperty('--emoji-tone-shape-hover', `path('${this.skinSegmentPath(index, SKIN_DIAL.hover, box)}')`);
      btn.style.setProperty('--emoji-tone-shape-on', `path('${this.skinSegmentPath(index, SKIN_DIAL.chosen, box)}')`);
      btn.style.setProperty('--emoji-tone-fill', `path('${this.skinSegmentPath(index, 0, box, SKIN_DIAL.rim)}')`);
      btn.style.setProperty('--emoji-tone-fill-hover', `path('${this.skinSegmentPath(index, SKIN_DIAL.hover, box, SKIN_DIAL.rim)}')`);
      btn.style.setProperty('--emoji-tone-fill-on', `path('${this.skinSegmentPath(index, SKIN_DIAL.chosen, box, SKIN_DIAL.rim)}')`);
      btn.addEventListener('click', () => this.chooseSkinTone(index));
      popover.appendChild(btn);

      return btn;
    });
    this.syncSkinToneSegments();

    // A clipped button cannot show an outline, so a keyboard ring traces its segment instead.
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const ringPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');

    ring.setAttribute('data-emoji-skin-focus', '');
    ring.setAttribute('aria-hidden', 'true');
    ring.setAttribute('hidden', '');
    ring.appendChild(ringPath);
    popover.appendChild(ring);
    popover.addEventListener('focusin', (event) => {
      const index = this._skinToneButtons.indexOf(event.target as HTMLButtonElement);
      const keyboard = index >= 0 && this.isKeyboardFocus(this._skinToneButtons[index]);

      ring.toggleAttribute('hidden', !keyboard);

      if (keyboard) {
        ringPath.setAttribute('d', this.skinSegmentPath(index, SKIN_DIAL.chosen));
      }
    });
    popover.addEventListener('focusout', () => {
      ring.setAttribute('hidden', '');
    });

    return popover;
  }

  /**
   * A ring segment in pixels; `grow` reaches the outer edge further out.
   * @param index - the tone
   * @param grow - how far past the ring the outer edge reaches
   * @param origin - draw relative to this box instead of the dial box
   * @param inset - pull every edge in by this many pixels (the tone inside its rim)
   */
  private skinSegmentPath(index: number, grow: number, origin = { x: 0, y: 0 }, inset = 0): string {
    const { cx, cy, inner: ringInner, outer, gap: ringGap, span } = SKIN_DIAL;
    const r = outer + grow - inset;
    const inner = ringInner + inset;
    const gap = ringGap + inset;
    const mid = skinToneAngle(index);
    // A fixed 1px gap at both radii keeps the seams even.
    const at = (radius: number, angle: number): string =>
      `${(cx + Math.cos(angle) * radius - origin.x).toFixed(2)} ${(cy + Math.sin(angle) * radius - origin.y).toFixed(2)}`;
    const o0 = mid + span / 2 - gap / r, o1 = mid - span / 2 + gap / r;
    const i0 = mid + span / 2 - gap / inner, i1 = mid - span / 2 + gap / inner;

    return `M${at(r, o0)} A${r} ${r} 0 0 0 ${at(r, o1)} L${at(inner, i1)} A${inner} ${inner} 0 0 1 ${at(inner, i0)} Z`;
  }

  /**
   * The dial hangs centred under its toggle; next to the picker's edge (the inline ":"
   * picker puts the toggle at the far end) it shifts back inside, as the picker clips it.
   */
  private keepSkinDialInside(): void {
    const margin = 4;

    this._skinTonePopover.style.removeProperty('--emoji-skin-shift');

    const dial = this._skinTonePopover.getBoundingClientRect();
    const bounds = this._element.getBoundingClientRect();

    if (dial.width === 0 || bounds.width === 0) {
      return;
    }

    const shift = Math.min(0, bounds.right - margin - dial.right) + Math.max(0, bounds.left + margin - dial.left);

    if (shift !== 0) {
      this._skinTonePopover.style.setProperty('--emoji-skin-shift', `${shift}px`);
    }
  }

  /** Engines without `:focus-visible` in `matches()` (jsdom) count as pointer focus. */
  private isKeyboardFocus(element: Element): boolean {
    try {
      return element.matches(':focus-visible');
    } catch {
      return false;
    }
  }

  /** Making the dial inert drops focus without a focusout, so the ring is hidden by hand. */
  private hideSkinToneFocusRing(): void {
    this._skinTonePopover.querySelector('[data-emoji-skin-focus]')?.setAttribute('hidden', '');
  }

  private syncSkinToneSegments(): void {
    for (const [index, btn] of this._skinToneButtons.entries()) {
      btn.setAttribute('aria-pressed', String(index === this._skinTone));
    }
  }

  private paintSkinToneToggle(): void {
    this._skinToneToggle.setAttribute('data-emoji-skin-current', String(this._skinTone));
    this._skinToneToggle.style.setProperty('--emoji-skin-dot', SKIN_TONE_COLORS[this._skinTone] ?? SKIN_TONE_COLORS[0]);
  }

  private skinMotion(): boolean {
    return typeof this._skinTonePopover.animate === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * A tracked animation; resolves when it ends or is stopped. It stays tracked after it
   * ends: a `fill: 'forwards'` fold keeps its segment hidden until stopSkinToneMotion cancels it.
   */
  private animateSkin(element: Element, frames: Keyframe[], options: KeyframeAnimationOptions): Promise<void> {
    const animation = element.animate(frames, options);

    this._skinToneAnimations.add(animation);

    return animation.finished.then(() => undefined, () => undefined);
  }

  private skinDelay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const id = window.setTimeout(() => {
        this._skinToneTimers.delete(id);
        resolve();
      }, ms);

      this._skinToneTimers.add(id);
    });
  }

  /** Stops every dial animation and timer, drops the landing circle and paints a pending tone. */
  private stopSkinToneMotion(): void {
    for (const animation of this._skinToneAnimations) {
      animation.cancel();
    }

    for (const id of this._skinToneTimers) {
      window.clearTimeout(id);
    }

    this._skinToneAnimations.clear();
    this._skinToneTimers.clear();
    this._skinTonePopover.querySelector('[data-emoji-skin-blob]')?.remove();

    for (const btn of this._skinToneButtons) {
      btn.style.removeProperty('opacity');
    }

    if (this._skinTonePending) {
      this._skinTonePending = false;
      this.paintSkinTone(false);
    }
  }

  private toggleSkinTonePopover(): void {
    if (!this._skinTonePopover.hidden && this._skinToneCloseAnimation === null) {
      this.closeSkinTonePopover(true);

      return;
    }

    this.stopSkinToneMotion();
    this._skinToneCloseAnimation = null;
    this._skinTonePopover.inert = false;
    this._skinTonePopover.removeAttribute('aria-hidden');
    this._skinTonePopover.hidden = false;
    this.keepSkinDialInside();
    this.syncSkinToneSegments();
    this.updateSkinToneToggleActive();

    if (this.skinMotion()) {
      // A folding fan: every segment starts stacked on the first and unfolds into place.
      for (const [index, btn] of this._skinToneButtons.entries()) {
        const from = toDegrees(skinToneAngle(0) - skinToneAngle(index));

        void this.animateSkin(btn, [
          { transform: `rotate(${from}deg) scale(0.55)`, opacity: index === 0 ? 0 : 1 },
          { transform: `rotate(${from}deg) scale(0.55)`, opacity: 1, offset: 0.08 },
          { transform: 'none', opacity: 1 },
        ], { duration: 400, delay: index * 22, easing: SKIN_SPRING, fill: 'backwards' });
      }
    }

    if (!this._inline) {
      this._skinToneButtons[this._skinTone]?.focus();
    }
  }

  /**
   * Hides the dial. Animated (toggle, click elsewhere in the picker), the fan folds shut
   * onto the first tone first. Unanimated (picker close, Escape), it stops every motion at once.
   * @param animate - fold before hiding
   */
  private closeSkinTonePopover(animate = false): void {
    if (this._open && !this._inline && this._skinTonePopover.contains(document.activeElement)) {
      this._skinToneToggle.focus();
    }

    this.hideSkinToneFocusRing();
    this._skinTonePopover.inert = true;
    this._skinTonePopover.setAttribute('aria-hidden', 'true');

    if (!animate || !this._open || this._skinTonePopover.hidden || !this.skinMotion()) {
      this.stopSkinToneMotion();
      this._skinToneCloseAnimation = null;
      this._skinTonePopover.hidden = true;
      this.updateSkinToneToggleActive();

      return;
    }

    const folds = this._skinToneButtons.map((btn, index) => {
      return this.animateSkin(btn, [
        { transform: 'none', opacity: 1 },
        { transform: `rotate(${toDegrees(skinToneAngle(0) - skinToneAngle(index))}deg) scale(0.5)`, opacity: 0 },
      ], { duration: 260, delay: (SKIN_TONE_COLORS.length - 1 - index) * 14, easing: SKIN_FOLD, fill: 'forwards' });
    });

    this._skinToneCloseAnimation = [...this._skinToneAnimations].at(-1) ?? null;
    this.updateSkinToneToggleActive();
    void Promise.all(folds).then(() => {
      if (this._skinTonePopover.inert) {
        this.closeSkinTonePopover();
      }
    });
  }

  private updateSkinToneToggleActive(): void {
    const active = !this._skinTonePopover.hidden && this._skinToneCloseAnimation === null;

    this._skinToneToggle.setAttribute('aria-expanded', String(active));
  }

  /**
   * Chooses a tone. With motion, the other tones fold shut behind it and the chosen
   * segment rounds into a circle on its flight to the toggle, landing at the dot's size;
   * the dot and the grid take the tone when it lands.
   * @param index - the chosen tone
   */
  private chooseSkinTone(index: number): void {
    const motion = this._open && this.skinMotion();

    this.setSkinTone(index, motion);

    if (!motion) {
      this.closeSkinTonePopover();

      return;
    }

    this.hideSkinToneFocusRing();
    this._skinTonePopover.inert = true;
    this._skinTonePopover.setAttribute('aria-hidden', 'true');

    // Inline mode leaves the caret in the document.
    if (!this._inline) {
      this._skinToneToggle.focus({ preventScroll: true });
    }

    const folds = this._skinToneButtons.map((btn, other) => {
      if (other === index) {
        return Promise.resolve();
      }

      return this.animateSkin(btn, [
        { transform: 'none', opacity: 1 },
        { transform: `rotate(${toDegrees(skinToneAngle(index) - skinToneAngle(other))}deg) scale(0.8)`, opacity: 0 },
      ], { duration: 220, delay: Math.abs(other - index) * 16, easing: SKIN_FOLD, fill: 'forwards' });
    });

    this._skinToneCloseAnimation = [...this._skinToneAnimations].at(-1) ?? null;
    this.updateSkinToneToggleActive();

    // The circle lifts off while the fold is still closing behind it.
    void this.skinDelay(120)
      .then(() => this.flySkinToneHome(index))
      .then(() => Promise.all(folds))
      .then(() => {
        if (!this._skinTonePending) {
          return;
        }

        this._skinTonePending = false;
        // Close first: closing stops every dial animation, and the dot's pop must survive it.
        this.closeSkinTonePopover();
        this.paintSkinTone(true);
      });
  }

  /**
   * The chosen segment morphs into a circle while it flies to the toggle dot. Both shapes
   * are traced with the same points in the same direction, so the outline never twists.
   */
  private async flySkinToneHome(index: number): Promise<void> {
    const btn = this._skinToneButtons[index];

    if (btn === undefined || !this._skinTonePending) {
      return;
    }

    const { cx, cy, inner, outer, chosen, span } = SKIN_DIAL;
    const steps = 24;
    const mid = skinToneAngle(index);
    const sample = (radius: number, from: number, to: number): Array<{ x: number; y: number }> =>
      Array.from({ length: steps }, (_, k) => {
        const angle = from + (to - from) * (k / (steps - 1));

        return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
      });
    const wedge = [
      ...sample(outer + chosen, mid + span / 2, mid - span / 2),
      ...sample(inner, mid - span / 2, mid + span / 2),
    ];
    const centre = { x: cx + Math.cos(mid) * (inner + outer) / 2, y: cy + Math.sin(mid) * (inner + outer) / 2 };
    const box = this._skinTonePopover.getBoundingClientRect();
    const dot = this._skinToneToggle.querySelector('[data-emoji-skin-dot]')?.getBoundingClientRect();
    const target = dot === undefined || dot.width === 0
      ? { x: cx, y: -14 }
      : { x: dot.left + dot.width / 2 - box.left, y: dot.top + dot.height / 2 - box.top };
    const radius = dot === undefined || dot.width === 0 ? 8 : dot.width / 2;
    const signedArea = wedge.reduce((sum, point, k) => {
      const next = wedge[(k + 1) % wedge.length];

      return sum + point.x * next.y - next.x * point.y;
    }, 0);
    const start = Math.atan2(wedge[0].y - centre.y, wedge[0].x - centre.x);
    const directions = wedge.map((_, k) => start + Math.sign(signedArea) * ((2 * Math.PI * k) / wedge.length));
    const bend = { x: (centre.x + target.x) / 2 + 34, y: (centre.y + target.y) / 2 + 8 };
    const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
    const frames = Array.from({ length: 13 }, (_, k) => {
      const t = k / 12;
      const u = 1 - t;
      const pos = {
        x: u * u * centre.x + 2 * u * t * bend.x + t * t * target.x,
        y: u * u * centre.y + 2 * u * t * bend.y + t * t * target.y,
      };
      // Fully round by mid-flight, so it travels as a circle.
      const round = Math.min(1, t / 0.5);
      const shape = round * round * (3 - 2 * round);
      const r = 13 + (radius - 13) * ease(t);
      const points = wedge.map((point, j) => {
        const wx = point.x + pos.x - centre.x;
        const wy = point.y + pos.y - centre.y;
        const x = wx + (pos.x + Math.cos(directions[j]) * r - wx) * shape;
        const y = wy + (pos.y + Math.sin(directions[j]) * r - wy) * shape + SKIN_BLOB_TOP;

        return `${x.toFixed(1)}px ${y.toFixed(1)}px`;
      });

      return { clipPath: `polygon(${points.join(', ')})` };
    });
    const blob = document.createElement('span');

    blob.setAttribute('data-emoji-skin-blob', '');
    blob.setAttribute('aria-hidden', 'true');
    blob.style.setProperty('--emoji-tone-color', SKIN_TONE_COLORS[index] ?? SKIN_TONE_COLORS[0]);
    blob.style.clipPath = frames[0].clipPath;
    this._skinTonePopover.appendChild(blob);
    btn.style.opacity = '0';
    await this.animateSkin(blob, frames, { duration: 380, easing: 'linear', fill: 'forwards' });
    blob.remove();
  }

  /**
   * Stores a tone. The dot and the grid follow at once, or wait for the landing.
   * @param index - the tone
   * @param deferPaint - leave the repaint to the landing circle
   */
  private setSkinTone(index: number, deferPaint = false): void {
    this._skinTone = index;
    saveSkinTone(index);
    this.syncSkinToneSegments();
    this._skinTonePending = deferPaint;

    if (!deferPaint) {
      this.paintSkinTone(true);
    }
  }

  private paintSkinTone(animate: boolean): void {
    this.paintSkinToneToggle();

    const dot = this._skinToneToggle.querySelector('[data-emoji-skin-dot]');

    if (animate && dot !== null && this._open && this.skinMotion()) {
      void this.animateSkin(dot, [{ transform: 'scale(0.4)' }, { transform: 'scale(1.35)', offset: 0.55 }, { transform: 'none' }], { duration: 260, easing: SKIN_SPRING });
    }

    this.applySkinToneToGrid(animate);
  }

  private updateSkinGlyph(host: HTMLElement, native: string, animate = false, delay = 0): void {
    const existingGlyph = host.querySelector<HTMLElement>('[data-emoji-skin-glyph]');
    const glyph = existingGlyph ?? document.createElement('span');

    if (existingGlyph === null) {
      glyph.setAttribute('data-emoji-skin-glyph', '');
      host.replaceChildren(glyph);
    }

    if (glyph.textContent === native) {
      return;
    }

    glyph.getAnimations?.().forEach(animation => animation.cancel());
    glyph.textContent = native;

    if (animate && typeof glyph.animate === 'function'
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      glyph.animate([
        { transform: 'translateY(8px) rotateX(-65deg) scale(0.8)', opacity: 0 },
        { transform: 'translateY(-2px) rotateX(0deg) scale(1.08)', opacity: 1, offset: 0.65 },
        { transform: 'translateY(0) rotateX(0deg) scale(1)', opacity: 1 },
      ], { duration: 360, delay, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' });
    }
  }

  /** Repaints every rendered emoji button at the current tone, preserving scroll. */
  private applySkinToneToGrid(animate = false): void {
    const emojis = new Map(this._allEmojis.map(emoji => [emoji.native, emoji]));
    const top = this._body.scrollTop;
    const bottom = top + this._body.clientHeight;
    const sectionsInView = new Set(animate ? this.sectionsInView() : []);
    const changes: Array<{ glyph: HTMLElement; native: string; visible: boolean }> = [];

    for (const button of this._emojiButtons) {
      const emoji = emojis.get(button.getAttribute('data-emoji-native') ?? '');
      const glyph = button.firstElementChild;

      if (emoji === undefined || !(glyph instanceof HTMLElement)) {
        continue;
      }

      const native = this.getSkinnedNative(emoji);

      if (glyph.textContent !== native) {
        const section = button.closest<HTMLElement>('[data-emoji-section]');
        const inView = section !== null && sectionsInView.has(section);
        const buttonTop = inView ? this.offsetWithinBody(button) : 0;

        changes.push({ glyph, native, visible: inView && buttonTop < bottom && buttonTop + button.offsetHeight > top });
      }
    }

    // Finish layout reads before changing any glyph text.
    changes.reduce((stagger, change) => {
      this.updateSkinGlyph(change.glyph, change.native, change.visible, Math.min(stagger, 96));

      return stagger + (change.visible ? 12 : 0);
    }, 0);
  }

  // ─── Random ─────────────────────────────────────────────────

  private pickRandom(): void {
    if (this._allEmojis.length === 0) {
      return;
    }

    const randomIndex = Math.floor(Math.random() * this._allEmojis.length);
    const emoji = this._allEmojis[randomIndex];

    if (emoji === undefined) {
      return;
    }

    this.select(emoji, this._element.querySelector('[data-emoji-picker-random]')?.getBoundingClientRect());
  }

  private scheduleScrollEffects(): void {
    cancelAnimationFrame(this._navRafId);
    this._navRafId = requestAnimationFrame(() => {
      this._navRafId = 0;

      if (!this._open) {
        return;
      }

      this.updateActiveNav();
    });
  }

  /**
   * Distance from the scroll container's top. A single offsetTop read falls
   * short when an ancestor becomes the offsetParent: a deferred section
   * (it contains layout), or inline mode's positioned first heading.
   */
  private offsetWithinBody(element: HTMLElement): number {
    if (element === this._body) {
      return 0;
    }

    const parent = element.offsetParent;

    return element.offsetTop + (parent instanceof HTMLElement ? this.offsetWithinBody(parent) : 0);
  }

  /**
   * Sections whose box meets the view. A skipped section's box is its size
   * estimate, so this reads nothing inside it — any read in there makes the
   * browser render the whole section.
   */
  private sectionsInView(): HTMLElement[] {
    const viewTop = this._body.scrollTop;
    const viewBottom = viewTop + this._body.clientHeight;

    return [...this._sectionEls.values()].filter(section =>
      section.offsetTop < viewBottom && section.offsetTop + section.offsetHeight > viewTop);
  }

  /** Publishes the real emoji row height, which the section estimates use. */
  private measureCell(): void {
    const grid = this._body.querySelector('[data-emoji-grid]');
    // The laid-out row track, not the cell's width: rows snap up to layout
    // units, and a rect reads short while the opening animation scales it.
    const value = grid === null ? '' : getComputedStyle(grid).gridTemplateRows.split(' ')[0] ?? '';

    // Skip unchanged writes: every emoji below the body inherits this property.
    if (parseFloat(value) > 0 && this._body.style.getPropertyValue('--emoji-cell') !== value) {
      this._body.style.setProperty('--emoji-cell', value);
    }
  }

  // ─── Category Navigation ──────────────────────────────────

  /**
   * @param visibleCategories - categories that have a section to jump to
   * @param shownCategories - categories that get a button; one with no section is disabled
   */
  private buildCategoryNav(visibleCategories: Set<string>, shownCategories: Set<string> = visibleCategories): void {
    this._nav.innerHTML = '';

    const indicator = document.createElement('span');

    indicator.setAttribute('data-emoji-nav-indicator', '');
    indicator.setAttribute('aria-hidden', 'true');
    this._nav.appendChild(indicator);
    this._navButtons.clear();
    this._activeNavId = '';

    for (const [catId, catIcon, chipKey] of CATEGORY_NAV) {
      if (!shownCategories.has(catId)) {
        continue;
      }

      const catLabel = this.translateCategory(catId);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.innerHTML = catIcon;

      if (this._inline) {
        onHover(btn, catLabel, { placement: 'top', delay: 300 });
      } else {
        const chip = document.createElement('span');

        chip.setAttribute('data-emoji-nav-label', '');
        chip.textContent = chipKey === undefined ? catLabel : this.i18n.t(chipKey);
        btn.appendChild(chip);
      }

      btn.setAttribute('aria-label', catLabel);
      btn.setAttribute('data-emoji-nav', catId);
      btn.disabled = !visibleCategories.has(catId);
      btn.className = [
        'flex-1 h-[36px] flex items-center justify-center',
        'cursor-pointer opacity-50',
        'text-neutral-500 theme-dark:text-neutral-400',
        '[&>svg]:w-[20px] [&>svg]:h-[20px]',
        'hover:opacity-100 hover:bg-neutral-100',
        'theme-dark:hover:bg-neutral-800',
        'transition-all duration-100',
      ].join(' ');
      btn.addEventListener('click', () => {
        hideTooltip();
        this.scrollToSection(catId);
      });

      this._nav.appendChild(btn);
      this._navButtons.set(catId, btn);
    }
  }

  private scrollToSection(categoryId: string): void {
    const section = this._sectionEls.get(categoryId);

    if (section === undefined) {
      return;
    }

    const bodyRect = this._body.getBoundingClientRect();
    const sectionRect = section.getBoundingClientRect();
    const top = Math.max(0, Math.min(
      this._body.scrollTop + (sectionRect.top - bodyRect.top),
      this._body.scrollHeight - this._body.clientHeight
    ));

    this._scrollDestination = top;
    this.setActiveNav(categoryId);
    this._body.scrollTo({
      top,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
    this.scheduleScrollEffects();
  }

  private updateActiveNav(): void {
    if (this._scrollDestination !== null) {
      // Smooth scrolling must not select the sections it passes through.
      if (Math.abs(this._body.scrollTop - this._scrollDestination) > 1) {
        return;
      }

      this._scrollDestination = null;
    }

    const sections = [...this._sectionEls.entries()];
    const atEnd = this._body.scrollHeight > this._body.clientHeight
      && this._body.scrollTop + this._body.clientHeight >= this._body.scrollHeight - 1;
    const activeId = atEnd
      ? sections.at(-1)?.[0] ?? ''
      : sections.filter(([, el]) => el.offsetTop - this._body.scrollTop <= 20)
        .reduce<string>((_, [id]) => id, sections[0]?.[0] ?? '');

    this.setActiveNav(activeId);
  }

  private setActiveNav(activeId: string): void {
    const activeButton = this._navButtons.get(activeId);
    const indicator = this._nav.querySelector<HTMLElement>('[data-emoji-nav-indicator]');

    if (activeButton !== undefined && indicator !== null) {
      indicator.style.width = `${activeButton.offsetWidth}px`;
      indicator.style.transform = `translateX(${activeButton.offsetLeft}px)`;
    }

    if (activeId === this._activeNavId) {
      return;
    }

    this._activeNavId = activeId;

    for (const [id, btn] of this._navButtons) {
      btn.setAttribute('aria-current', String(id === activeId));

      if (id === activeId) {
        btn.classList.remove('opacity-50');
        btn.classList.add('opacity-100', 'bg-neutral-100', 'theme-dark:bg-neutral-800');
      } else {
        btn.classList.remove('opacity-100', 'bg-neutral-100', 'theme-dark:bg-neutral-800');
        btn.classList.add('opacity-50');
      }
    }
  }

  // ─── Rendering ────────────────────────────────────────────

  private getSkinnedNative(emoji: ProcessedEmoji): string {
    return emoji.skins[this._skinTone] ?? emoji.native;
  }

  /**
   * Sets the query and re-filters, exactly as if the user had typed it — the
   * filter input's own `input` listener calls this same method. Used by the
   * inline ":" trigger to mirror its typed query into the picker.
   * @param query - the query to filter by
   */
  public setQuery(query: string): void {
    this._filterInput.value = query;
    this.handleFilterChange(query);
  }

  private handleFilterChange(query: string): void {
    hideTooltip();
    this._scrollDestination = null;
    this._clearSearchButton.hidden = query.length === 0;
    this._body.scrollTop = 0;
    this.scheduleScrollEffects();

    if (query.trim() === '') {
      this._announcer.textContent = '';
      this.setNavHidden(false);
      this.setFlat(false);
      this.renderEmojiGrid(this._allEmojis);

      return;
    }

    const results = searchEmojisRanked(this._allEmojis, query, this._localeData, UNCAPPED_RESULTS);

    this.announceResults(results.length);

    if (results.length === 0) {
      this.setNavHidden(true);
      this.setFlat(false);

      if (!this._showingEmptyState) {
        this.renderEmptyState();
      }
    } else {
      this._body.innerHTML = '';
      this._emojiButtons = [];
      this._focusedEmoji = null;
      this._sectionEls.clear();
      this._showingEmptyState = false;
      this._hasFullGrid = false;
      this.renderResults(results);
    }

    // A short list changes the menu's height, which moves a menu that sits above the caret.
    if (this._inline && this._open && this._anchorEl !== null) {
      this.position(this._anchorEl);
    }
  }

  /**
   * The full picker lists matches under category names, without its chips.
   * The inline menu keeps its bar for a long list, and shows a short one as a
   * single block in best-match order.
   * @param results - the matches, best first
   */
  private renderResults(results: ProcessedEmoji[]): void {
    const flat = this._inline && results.length <= INLINE_FLAT_MAX;

    this.setFlat(flat);

    if (flat) {
      const section = document.createElement('div');

      section.setAttribute('data-emoji-section', 'results');
      section.appendChild(this.buildGrid(results));
      this._body.appendChild(section);
      this.setNavHidden(true);

      return;
    }

    const byCategory = groupEmojisByCategory(results);

    for (const [category, categoryEmojis] of byCategory) {
      const section = this.buildSection(this.translateCategory(category), categoryEmojis);

      section.setAttribute('data-emoji-section', category);
      this._sectionEls.set(category, section);
      this._body.appendChild(section);
    }

    if (this._inline) {
      this.buildCategoryNav(new Set(byCategory.keys()), new Set(this._allEmojis.map(emoji => emoji.category)));
      this.scheduleScrollEffects();
    }

    this.setNavHidden(!this._inline);
  }

  /** Publishes the short-list layout on the picker root, where the CSS reads it. */
  private setFlat(flat: boolean): void {
    this._element.toggleAttribute('data-emoji-picker-flat', flat);
  }

  /** Writes the current result count (or the empty message) to the live region. */
  private announceResults(count: number): void {
    this._announcer.textContent = count === 0
      ? this.i18n.t(NO_EMOJIS_FOUND_KEY)
      : this.i18n.t(EMOJI_SEARCH_RESULTS_KEY).replace('{count}', String(count));
  }

  private renderEmojiGrid(emojis: ProcessedEmoji[]): void {
    this._body.innerHTML = '';
    this._emojiButtons = [];
    this._focusedEmoji = null;
    this._sectionEls.clear();
    this._showingEmptyState = false;

    const visibleCategories = new Set<string>();
    const recent = this.recentEmojis();

    this._renderedRecent = recent.map(emoji => emoji.native).join(' ');

    if (recent.length > 0) {
      // Outside _sectionEls: it has no chip, and the first chip stays current over it.
      const section = this.buildSection(this.i18n.t(RECENT_EMOJIS_KEY), recent);

      section.setAttribute('data-emoji-section', 'recent');
      this._body.appendChild(section);
    }

    if (this._curated) {
      const calloutEmojis = CURATED_CALLOUT_EMOJIS
        .map(native => emojis.find(e => e.native === native))
        .filter((e): e is ProcessedEmoji => e !== undefined);

      if (calloutEmojis.length > 0) {
        visibleCategories.add('callout');
        const section = this.buildSection(this.translateCategory('callout'), calloutEmojis);
        section.setAttribute('data-emoji-section', 'callout');
        this._sectionEls.set('callout', section);
        this._body.appendChild(section);
      }
    }

    // Curated emojis already have their own section above. Without it, they
    // stay in their own categories.
    const curatedSet = this._curated ? new Set(CURATED_CALLOUT_EMOJIS) : new Set<string>();
    const byCategory = groupEmojisByCategory(emojis.filter(e => !curatedSet.has(e.native)));

    for (const [category, categoryEmojis] of byCategory) {
      visibleCategories.add(category);
      const section = this.buildSection(this.translateCategory(category), categoryEmojis);
      section.setAttribute('data-emoji-section', category);
      this._sectionEls.set(category, section);
      this._body.appendChild(section);
    }

    this.buildCategoryNav(visibleCategories);
    this.setNavHidden(false);
    this.setFlat(false);
    this._hasFullGrid = true;

    // Set initial active nav after layout
    this.scheduleScrollEffects();
  }

  private renderEmptyState(): void {
    this._body.innerHTML = '';
    this._emojiButtons = [];
    this._focusedEmoji = null;
    this._showingEmptyState = true;
    this._sectionEls.clear();
    this._hasFullGrid = false;

    const empty = document.createElement('div');

    empty.setAttribute('data-emoji-picker-empty', '');
    empty.className = [
      'flex flex-col items-center justify-center py-10',
      'text-neutral-400 theme-dark:text-neutral-500 select-none',
      'animate-[blok-emoji-empty-in_300ms_ease-out_both]',
    ].join(' ');

    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('data-emoji-picker-empty-art', '');

    for (const emoji of ['🙂', '🧐', '✨']) {
      const card = document.createElement('span');

      card.textContent = emoji;
      icon.appendChild(card);
    }

    const text = document.createElement('span');
    text.className = 'text-[13px] font-medium';
    text.textContent = this.i18n.t(NO_EMOJIS_FOUND_KEY);

    const back = document.createElement('button');

    back.type = 'button';
    back.textContent = this.i18n.t('tools.callout.clearEmojiSearch');
    back.addEventListener('click', () => {
      this.setQuery('');
      this._filterInput.focus();
    });

    const hint = document.createElement('p');

    hint.setAttribute('data-emoji-picker-hint', '');
    hint.textContent = this.i18n.t('tools.callout.emojiSearchHint');
    empty.appendChild(icon);
    empty.appendChild(text);
    empty.appendChild(hint);
    if (!this._inline) {
      empty.appendChild(back);
    }

    this._body.appendChild(empty);
  }

  private translateCategory(categoryId: string): string {
    const key = CATEGORY_I18N_KEYS[categoryId];

    return key !== undefined ? this.i18n.t(key) : categoryId;
  }

  private buildSection(title: string, emojis: ProcessedEmoji[]): HTMLElement {
    const section = document.createElement('div');
    const heading = document.createElement('div');

    heading.setAttribute('data-emoji-section-title', '');
    heading.className = [
      'text-[11px] font-semibold uppercase tracking-wider px-2 pt-3 pb-1.5',
      'text-neutral-400/80 theme-dark:text-neutral-500/80',
      'sticky top-0 bg-white theme-dark:bg-neutral-900 z-10',
    ].join(' ');
    const label = document.createElement('span');

    label.textContent = title;
    heading.appendChild(label);

    section.appendChild(heading);
    section.appendChild(this.buildGrid(emojis));

    if (this._sectionEls.size > 0) {
      // Must match the grid columns and the 8-column media query in emoji-picker.css.
      const columns = window.matchMedia('(max-width: 380px)').matches ? 8 : 10;

      section.setAttribute('data-emoji-section-deferred', '');
      section.style.setProperty('--emoji-rows', String(Math.ceil(emojis.length / columns)));
    }

    return section;
  }

  /**
   * Hides the category nav and publishes that state on the picker root, where
   * the CSS reads it. The root may not carry a `:has()` for this: it holds
   * every emoji button, so a `:has()` anchored there turns each glyph text
   * swap below it into a full-subtree style invalidation.
   * @param hidden - whether the category nav is hidden
   */
  private setNavHidden(hidden: boolean): void {
    this._nav.hidden = hidden;
    this._element.toggleAttribute('data-emoji-picker-navless', hidden);
  }

  private getDisplayName(emoji: ProcessedEmoji): string {
    return (this._localeData?.[emoji.native]?.n ?? emoji.name).toLocaleLowerCase();
  }

  /**
   * Re-runs the active search after more search data lands.
   * Only while typing: a rebuild would detach a result the user arrowed to.
   * Inline mode never re-runs: the ":" composer holds a reference to the
   * highlighted button.
   * @returns true when the search was re-run
   */
  private refilterWhileTyping(): boolean {
    const typing = document.activeElement === this._filterInput;

    if (!this._open || this._inline || !typing || this._filterInput.value.trim() === '') {
      return false;
    }

    this.handleFilterChange(this._filterInput.value);

    return true;
  }

  /**
   * Relabels the rendered grid once the locale lands. Runs even while closed:
   * a reopen reuses the grid (`_hasFullGrid`) without rebuilding buttons.
   */
  private applyLocaleToGrid(): void {
    if (this.refilterWhileTyping()) {
      return;
    }

    const emojis = new Map(this._allEmojis.map(emoji => [emoji.native, emoji]));

    for (const button of this._emojiButtons) {
      const emoji = emojis.get(button.getAttribute('data-emoji-native') ?? '');

      if (emoji === undefined) {
        continue;
      }

      const name = this.getDisplayName(emoji);

      button.setAttribute('aria-label', name);

      if (this._inline) {
        onHover(button, name, { placement: 'bottom' });
      }
    }
  }

  private buildGrid(emojis: ProcessedEmoji[]): HTMLElement {
    const grid = document.createElement('div');

    grid.setAttribute('data-emoji-grid', '');
    grid.className = 'grid grid-cols-10 gap-0.5 px-0.5 pt-1';

    for (const emoji of emojis) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const glyph = document.createElement('span');

      glyph.setAttribute('data-emoji-glyph', '');
      glyph.setAttribute('aria-hidden', 'true');
      if (emoji.skins.length > 1) {
        this.updateSkinGlyph(glyph, this.getSkinnedNative(emoji));
      } else {
        glyph.textContent = emoji.native;
      }

      btn.appendChild(glyph);
      btn.setAttribute('aria-label', this.getDisplayName(emoji));
      btn.setAttribute('data-emoji-native', emoji.native);
      btn.tabIndex = this._emojiButtons.length === 0 ? 0 : -1;

      if (this._emojiButtons.length === 0) {
        this._focusedEmoji = btn;
      }

      this._emojiButtons.push(btn);
      btn.className = [
        'aspect-square flex items-center justify-center',
        'text-[1.25rem] leading-none cursor-pointer',
        'hover:bg-neutral-100 theme-dark:hover:bg-neutral-800',
        'transition-transform duration-75',
      ].join(' ');
      btn.addEventListener('click', () => {
        this.select(emoji, glyph.getBoundingClientRect());
        this.close();
      });

      // The stage names the emoji under the pointer; inline mode has no stage.
      if (this._inline) {
        onHover(btn, this.getDisplayName(emoji), { placement: 'bottom' });
      }
      grid.appendChild(btn);
    }

    return grid;
  }

  // ─── Theme ──────────────────────────────────────────────

  /**
   * Resolves the current Blok theme using the same logic as ThemeManager:
   *   data-blok-theme="dark"  → dark
   *   data-blok-theme="light" → light
   *   absent (auto)           → follow prefers-color-scheme
   */
  private resolveTheme(): 'dark' | 'light' {
    const attr = document.documentElement.getAttribute('data-blok-theme');

    if (attr === 'dark') {
      return 'dark';
    }

    if (attr === 'light') {
      return 'light';
    }

    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  // ─── Backdrop ──────────────────────────────────────────────

  private showBackdrop(): void {
    this.removeBackdrop();

    const backdrop = document.createElement('div');

    backdrop.setAttribute('data-blok-emoji-picker-backdrop', '');
    backdrop.style.position = 'fixed';
    backdrop.style.inset = '0';
    backdrop.style.zIndex = '50';

    // Close only when clicking the backdrop itself, not the picker inside it
    backdrop.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.target === backdrop) {
        this.close();
      }
    });

    // Wrap: insert backdrop where the picker is, then move picker inside it
    this._element.parentElement?.insertBefore(backdrop, this._element);
    backdrop.appendChild(this._element);
    this._backdrop = backdrop;

    // Lock page scroll so the picker stays in place
    this._savedOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
  }

  private removeBackdrop(): void {
    if (this._backdrop === null) {
      return;
    }

    // Restore page scroll
    document.documentElement.style.overflow = this._savedOverflow;

    // Move picker back to where the backdrop is before removing it
    this._backdrop.parentElement?.insertBefore(this._element, this._backdrop);
    this._backdrop.remove();
    this._backdrop = null;
  }

  // ─── Positioning ──────────────────────────────────────────

  private position(anchor: HTMLElement): void {
    const rect = this._anchorRectOverride ?? anchor.getBoundingClientRect();
    const pickerRect = this._element.getBoundingClientRect();
    // Layout sizes stay stable while the opening transform is running.
    const height = this._element.offsetHeight || pickerRect.height;
    const width = this._element.offsetWidth || pickerRect.width;
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const above = rect.bottom + height + 4 > viewportHeight - 8 && rect.top > viewportHeight - rect.bottom;
    const preferredTop = above ? rect.top - height - 4 : rect.bottom + 4;
    const top = Math.max(8, Math.min(preferredTop, viewportHeight - height - 8));
    // Starts before the anchor's start edge: its right edge in RTL.
    const preferredLeft = getElementDirection(this._element) === 'rtl'
      ? rect.right + this._startInset - width
      : rect.left - this._startInset;
    const left = Math.max(8, Math.min(preferredLeft, viewportWidth - width - 8));

    this._element.style.top = `${top}px`;
    this._element.style.left = `${left}px`;
    this._element.style.transformOrigin = `${Math.max(0, Math.min(width, rect.left + rect.width / 2 - left))}px ${above ? 'bottom' : 'top'}`;
  }
}
