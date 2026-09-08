// src/tools/callout/emoji-picker/index.ts

import { loadEmojiData, groupEmojisByCategory, CURATED_CALLOUT_EMOJIS, type ProcessedEmoji } from '../../../components/utils/emoji/emoji-data';
import { searchEmojisRanked } from '../../../components/utils/emoji/emoji-search-ranked';
import { loadEmojiLocale, type EmojiLocaleData } from '../../../components/utils/emoji/emoji-locale';
import { hide as hideTooltip, onHover } from '../../../components/utils/tooltip';
import { DATA_ATTR } from '../../../components/constants';
import { getTabbables } from '../../../components/utils/modal-dialog';
import { createPositionTracker, type PositionTracker } from '../../../components/utils/popover/anchored-position';
import {
  REMOVE_EMOJI_KEY, FILTER_EMOJIS_KEY, CALLOUT_EMOJI_CATEGORY_KEY, NO_EMOJIS_FOUND_KEY, EMOJI_SEARCH_RESULTS_KEY, PICK_RANDOM_KEY, SKIN_TONE_KEY,
  EDIT_ICON_KEY,
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
  IconEmojiTrash,
  IconCross,
  IconEmojiDice,
  IconSearch,
  IconEmojiSparkles,
  IconEmojiWink,
  IconEmojiSprout,
  IconEmojiBowl,
  IconEmojiGamepad,
  IconEmojiMap,
  IconEmojiLightbulb,
  IconEmojiHearts,
  IconEmojiFlag,
} from '../../../components/icons';

interface I18n {
  t: (key: string) => string;
}

interface EmojiPickerOptions {
  onSelect: (native: string) => void;
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
}

const UNCAPPED_RESULTS = Number.POSITIVE_INFINITY;
const REEL_DISTORTION = {
  maxTiltDeg: 50,
  maxSquashX: 0.09,
  maxSquashY: 0.25,
  maxDim: 0.32,
  perspective: 400,
};

/** SVG icon for each emoji category (display order). */
const CATEGORY_NAV: ReadonlyArray<readonly [id: string, icon: string]> = [
  ['callout', IconEmojiSparkles],
  ['people', IconEmojiWink],
  ['nature', IconEmojiSprout],
  ['foods', IconEmojiBowl],
  ['activity', IconEmojiGamepad],
  ['places', IconEmojiMap],
  ['objects', IconEmojiLightbulb],
  ['symbols', IconEmojiHearts],
  ['flags', IconEmojiFlag],
];

/** Raised-hand emoji for each skin tone (default + 5 Fitzpatrick modifiers). */
const SKIN_TONE_HANDS: readonly string[] = [
  '✋', '✋🏻', '✋🏼', '✋🏽', '✋🏾', '✋🏿',
];

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

/**
 * Warm the caches the picker blocks on when it opens.
 *
 * The emoji dataset is a lazy chunk of ~415KB (~57KB compressed), and `open()`
 * awaits it. Fetching it at click time is nearly the whole of a slow first open:
 * on a throttled 4G profile that open measured ~500ms, versus ~50ms once this
 * has run. Both loaders are module-cached, so calling this on hover/focus of the
 * trigger moves the transfer off the open path — and repeat calls are free.
 *
 * Fire-and-forget: a warm-up that fails must stay silent and let `open()` retry.
 * @param locale - active editor locale, whose emoji annotations are warmed too
 */
export function prefetchEmojiPickerData(locale: string): void {
  void loadEmojiData().catch(() => undefined);

  if (locale !== 'en') {
    void loadEmojiLocale(locale).catch(() => undefined);
  }
}

export class EmojiPicker {
  private readonly onSelect: (native: string) => void;
  private readonly onRemove: () => void;
  private readonly i18n: I18n;
  private readonly _locale: string;
  private readonly _inline: boolean;
  private _localeData: EmojiLocaleData | null = null;
  /** Caret rect override for inline mode — see `open()`'s `anchorRect` param. */
  private _anchorRectOverride: DOMRect | null = null;

  private _element: HTMLElement;
  private _body: HTMLElement;
  private _header!: HTMLElement;
  private _nav: HTMLElement;
  private _filterInput: HTMLInputElement;
  private _announcer: HTMLElement;
  private _clearSearchButton: HTMLButtonElement;
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
  private _reelRows: Array<{ top: number; height: number; glyphs: HTMLElement[] }> = [];
  private _curledGlyphs = new Set<HTMLElement>();
  /** Bound capture-phase Escape handler, registered on `document` while open. */
  private _onDocumentKeydown: (e: KeyboardEvent) => void;
  /** Skin tone selector buttons for visual updates. */
  private _skinToneButtons: HTMLButtonElement[] = [];
  private _skinToneToggle!: HTMLButtonElement;
  private _skinTonePopover!: HTMLElement;
  private _skinToneCloseAnimation: Animation | null = null;

  constructor(options: EmojiPickerOptions) {
    this.onSelect = options.onSelect;
    this.onRemove = options.onRemove;
    this.i18n = options.i18n;
    this._locale = options.locale;
    this._inline = options.inline ?? false;
    this._element = this.buildElement();

    const body = this._element.querySelector<HTMLElement>('[data-emoji-picker-body]');
    const nav = this._element.querySelector<HTMLElement>('[data-emoji-picker-nav]');
    const filterInput = this._element.querySelector<HTMLInputElement>('input[type="text"]');
    const announcer = this._element.querySelector<HTMLElement>('[data-emoji-picker-announcer]');

    const clearSearchButton = this._element.querySelector<HTMLButtonElement>('[data-emoji-picker-clear]');

    if (body === null || nav === null || filterInput === null || announcer === null || clearSearchButton === null) {
      throw new Error('EmojiPicker: failed to build required elements');
    }

    this._body = body;
    this._nav = nav;
    this._filterInput = filterInput;
    this._announcer = announcer;
    this._clearSearchButton = clearSearchButton;

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
   */
  public async open(anchor: HTMLElement, anchorRect?: DOMRect): Promise<void> {
    const active = document.activeElement;

    this._previouslyFocused = active instanceof HTMLElement && active !== document.body ? active : null;
    this._anchorEl = anchor;
    this._anchorRectOverride = anchorRect ?? null;
    this._open = true;
    this._scrollDestination = null;
    this._filterInput.value = '';
    this._clearSearchButton.hidden = true;
    this._element.setAttribute('data-theme', this.resolveTheme());

    const storedTone = loadSkinTone();
    const toneChanged = storedTone !== this._skinTone;

    if (toneChanged) {
      this._skinTone = storedTone;
      this.updateSkinGlyph(this._skinToneToggle, SKIN_TONE_HANDS[storedTone]);

      for (const [i, btn] of this._skinToneButtons.entries()) {
        this.applySkinToneActiveStyle(btn, i === storedTone);
      }
    }

    if (this._allEmojis.length === 0) {
      this._allEmojis = await loadEmojiData();
    }

    if (this._locale !== 'en' && this._localeData === null) {
      const localeData = await loadEmojiLocale(this._locale);

      if (localeData !== null) {
        this._localeData = localeData;
      }
    }

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
    this._positionTracker?.detach();
    this._positionTracker = createPositionTracker(this._element, (event) => {
      if (event?.target === this._body) {
        return;
      }

      if (this._open && this._anchorEl !== null) {
        this.position(this._anchorEl);

        if (event === undefined) {
          this._reelRows = [];
          this.scheduleScrollEffects();
        }
      }
    });
    this._positionTracker.attach();

    // Replay the opening animation
    void this._element.offsetHeight;
    this._element.style.animation = '';

    if (!this._inline) {
      // Capture-phase Escape so it closes the picker before any bubbling
      // handler. Inline mode's caller already owns Escape (and Tab/arrows),
      // so a second capture-phase listener here would race it.
      document.addEventListener('keydown', this._onDocumentKeydown, true);
      this._filterInput.focus();
    }
  }

  public close(): void {
    this._open = false;
    this._scrollDestination = null;
    cancelAnimationFrame(this._navRafId);
    this._navRafId = 0;
    this.resetReel();
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
      el.setAttribute('aria-label', this.i18n.t(EDIT_ICON_KEY));
    }

    el.className = [
      'fixed z-50 w-[400px] overflow-hidden rounded-xl',
      'border border-neutral-200/70 bg-white shadow-2xl',
      'theme-dark:border-neutral-700/50 theme-dark:bg-neutral-900',
    ].join(' ');
    el.hidden = true;

    // Header: search input + random button + remove button
    const header = document.createElement('div');

    this._header = header;

    header.setAttribute('data-emoji-picker-header', '');
    header.className = 'flex items-center gap-2.5 px-3 pt-3 pb-2';

    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'relative flex-1 min-w-0';
    searchWrapper.setAttribute('data-emoji-picker-search', '');

    const iconSpan = document.createElement('span');
    iconSpan.className = [
      'pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 flex items-center',
      'text-neutral-400 theme-dark:text-neutral-500 [&>svg]:w-[16px] [&>svg]:h-[16px]',
    ].join(' ');
    iconSpan.innerHTML = IconSearch;

    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('role', 'searchbox');
    input.setAttribute('aria-label', this.i18n.t(FILTER_EMOJIS_KEY));
    input.placeholder = this.i18n.t(FILTER_EMOJIS_KEY);
    input.className = [
      'w-full text-[13px] rounded-lg py-[7px] pl-8 pr-3 outline-hidden',
      'bg-neutral-100 text-neutral-800 placeholder:text-neutral-400',
      'theme-dark:bg-neutral-800 theme-dark:text-neutral-200 theme-dark:placeholder:text-neutral-500',
      'focus:ring-2 focus:ring-neutral-300/60 theme-dark:focus:ring-neutral-600/60',
      'transition-shadow duration-150',
    ].join(' ');
    input.addEventListener('input', () => this.handleFilterChange(input.value));

    searchWrapper.appendChild(iconSpan);
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
      'w-[28px] h-[28px] flex items-center justify-center rounded-lg',
      'text-[14px] leading-none cursor-pointer select-none',
      'hover:bg-neutral-100 theme-dark:hover:bg-neutral-800',
      'active:scale-90 transition-all duration-100',
    ].join(' ');
    this.updateSkinGlyph(skinToggle, SKIN_TONE_HANDS[this._skinTone]);
    skinToggle.addEventListener('click', () => this.toggleSkinTonePopover());
    this._skinToneToggle = skinToggle;
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
      'flex-shrink-0 w-[34px] h-[34px] flex items-center justify-center rounded-lg',
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
      'flex-shrink-0 w-[34px] h-[34px] flex items-center justify-center rounded-lg',
      'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600',
      'theme-dark:hover:bg-neutral-800 theme-dark:hover:text-neutral-300',
      'transition-colors duration-100 cursor-pointer',
    ].join(' ');
    removeBtn.innerHTML = IconEmojiTrash;
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
    header.appendChild(actionGroup);
    el.appendChild(header);

    if (this._inline) {
      // Inline mode's search surface is the typed ":query" text itself
      // (see EmojiTrigger.setQuery) — no visible field to show. Random-pick
      // and remove don't apply either: there is no already-chosen emoji
      // glyph to reroll or clear.
      searchWrapper.hidden = true;
      randomBtn.hidden = true;
      removeBtn.hidden = true;
    }

    // Scrollable body
    const body = document.createElement('div');
    body.setAttribute('data-emoji-picker-body', '');
    body.className = 'overflow-y-auto max-h-[260px] px-1.5 pb-2';
    el.appendChild(body);

    // Category navigation bar (below emoji grid)
    const nav = document.createElement('div');
    nav.setAttribute('data-emoji-picker-nav', '');
    nav.className = [
      'flex items-center gap-1 px-2 pt-1 pb-1',
      'border-t border-neutral-100 theme-dark:border-neutral-800',
    ].join(' ');
    const footer = document.createElement('div');

    footer.setAttribute('data-emoji-picker-footer', '');
    footer.appendChild(nav);
    el.appendChild(footer);

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

      if (!this._skinTonePopover.hidden
        && !this._skinTonePopover.contains(target)
        && !this._skinToneToggle.contains(target)) {
        this.closeSkinTonePopover();
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
      ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns,
      Home: -index, End: this._emojiButtons.length - 1 - index,
    };
    const step = steps[event.key];

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

  private buildSkinTonePopover(): HTMLElement {
    const popover = document.createElement('div');

    popover.setAttribute('data-emoji-picker-skin-tone', '');
    popover.className = [
      'absolute right-0 top-full mt-1.5 z-20',
      'flex items-center gap-0.5 p-1 rounded-xl',
      'bg-white border border-neutral-200/70 shadow-lg',
      'theme-dark:bg-neutral-800 theme-dark:border-neutral-700/50',
    ].join(' ');
    popover.hidden = true;
    popover.setAttribute('role', 'group');
    popover.setAttribute('aria-label', this.i18n.t(SKIN_TONE_KEY));
    popover.addEventListener('keydown', (event: KeyboardEvent) => {
      const target = event.target;

      if (!(target instanceof HTMLButtonElement)) {
        return;
      }

      const index = this._skinToneButtons.indexOf(target);
      const directions: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
      const direction = directions[event.key] ?? 0;

      if (index < 0 || direction === 0) {
        return;
      }

      event.preventDefault();
      this._skinToneButtons[(index + direction + this._skinToneButtons.length) % this._skinToneButtons.length]?.focus();
    });

    const indicator = document.createElement('span');

    indicator.setAttribute('data-emoji-skin-indicator', '');
    indicator.setAttribute('aria-hidden', 'true');
    popover.appendChild(indicator);
    popover.style.setProperty('--emoji-skin-index', String(this._skinTone));
    this._skinToneButtons = [];

    for (const [index, hand] of SKIN_TONE_HANDS.entries()) {
      const btn = document.createElement('button');

      btn.type = 'button';
      this.updateSkinGlyph(btn, hand);
      btn.style.setProperty('--emoji-tone-order', String(index));
      btn.setAttribute('aria-label', `${this.i18n.t(SKIN_TONE_KEY)} ${index + 1}`);
      btn.className = [
        'w-[32px] h-[32px] flex items-center justify-center rounded-lg',
        'text-[1.2rem] leading-none cursor-pointer select-none',
        'hover:bg-neutral-100 theme-dark:hover:bg-neutral-700',
        'active:scale-90 transition-all duration-100',
      ].join(' ');
      this.applySkinToneActiveStyle(btn, index === this._skinTone);
      btn.addEventListener('click', () => {
        this.setSkinTone(index);
        this.closeSkinTonePopover(true);
      });
      popover.appendChild(btn);
      this._skinToneButtons.push(btn);
    }

    return popover;
  }

  private applySkinToneActiveStyle(btn: HTMLButtonElement, active: boolean): void {
    const classes = ['bg-neutral-100', 'theme-dark:bg-neutral-700', 'ring-2', 'ring-neutral-300/60', 'theme-dark:ring-neutral-600/60'];

    btn.setAttribute('aria-pressed', String(active));

    if (active) {
      btn.classList.add(...classes);
    } else {
      btn.classList.remove(...classes);
    }
  }

  private toggleSkinTonePopover(): void {
    if (!this._skinTonePopover.hidden && this._skinToneCloseAnimation === null) {
      this.closeSkinTonePopover();

      return;
    }

    this._skinToneCloseAnimation?.cancel();
    this._skinToneCloseAnimation = null;
    this._skinTonePopover.inert = false;
    this._skinTonePopover.removeAttribute('aria-hidden');
    this._skinTonePopover.style.setProperty('--emoji-skin-index', String(this._skinTone));
    this._skinTonePopover.hidden = false;
    this.updateSkinToneToggleActive();
    if (!this._inline) {
      this._skinToneButtons[this._skinTone]?.focus();
    }
  }

  private closeSkinTonePopover(animate = false): void {
    this._skinToneCloseAnimation?.cancel();
    this._skinToneCloseAnimation = null;

    if (this._open && !this._inline && this._skinTonePopover.contains(document.activeElement)) {
      this._skinToneToggle.focus();
    }

    this._skinTonePopover.inert = true;
    this._skinTonePopover.setAttribute('aria-hidden', 'true');

    if (animate && this._open && typeof this._skinTonePopover.animate === 'function'
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this._skinToneCloseAnimation = this._skinTonePopover.animate([
        { opacity: 1, transform: 'scale(1)' },
        { opacity: 0, transform: 'translateY(-3px) scale(0.96)' },
      ], { duration: 140, delay: 120, easing: 'ease-in', fill: 'forwards' });
      this._skinToneCloseAnimation.onfinish = () => this.closeSkinTonePopover();
    } else {
      this._skinTonePopover.hidden = true;
    }

    this.updateSkinToneToggleActive();
  }

  private updateSkinToneToggleActive(): void {
    const active = !this._skinTonePopover.hidden && this._skinToneCloseAnimation === null;

    this._skinToneToggle.setAttribute('aria-expanded', String(active));

    const classes = ['bg-neutral-100', 'theme-dark:bg-neutral-700'];

    if (active) {
      this._skinToneToggle.classList.add(...classes);
    } else {
      this._skinToneToggle.classList.remove(...classes);
    }
  }

  private setSkinTone(index: number): void {
    this._skinTone = index;
    saveSkinTone(index);

    // Update the hand toggle to reflect current skin tone
    this.updateSkinGlyph(this._skinToneToggle, SKIN_TONE_HANDS[index], true);
    this._skinTonePopover.style.setProperty('--emoji-skin-index', String(index));

    // Update skin tone popover button visuals
    for (const [i, btn] of this._skinToneButtons.entries()) {
      this.applySkinToneActiveStyle(btn, i === index);
    }

    this.applySkinToneToGrid(true);
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
      // The outer glyph owns the reel transform; the inner span owns the swap.
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
    const changes: Array<{ glyph: HTMLElement; native: string; visible: boolean }> = [];

    for (const button of this._emojiButtons) {
      const emoji = emojis.get(button.getAttribute('data-emoji-native') ?? '');
      const glyph = button.firstElementChild;

      if (emoji === undefined || !(glyph instanceof HTMLElement)) {
        continue;
      }

      const native = this.getSkinnedNative(emoji);

      if (glyph.textContent !== native) {
        changes.push({
          glyph, native,
          visible: animate && button.offsetTop < bottom && button.offsetTop + button.offsetHeight > top,
        });
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

    this.onSelect(this.getSkinnedNative(emoji));
  }

  private scheduleScrollEffects(): void {
    cancelAnimationFrame(this._navRafId);
    this._navRafId = requestAnimationFrame(() => {
      this._navRafId = 0;

      if (!this._open) {
        return;
      }

      this.updateActiveNav();
      this.updateReel();
    });
  }

  private resetReel(): void {
    for (const glyph of this._curledGlyphs) {
      glyph.style.removeProperty('transform');
      glyph.style.removeProperty('transform-origin');
      glyph.style.removeProperty('opacity');
    }

    this._curledGlyphs.clear();
  }

  /**
   * Distance from the scroll container's top. Inline mode positions the
   * heading that carries the tone controls, which makes it the label's
   * offsetParent, so a single offsetTop read is short by the heading's own.
   */
  private offsetWithinBody(element: HTMLElement): number {
    if (element === this._body) {
      return 0;
    }

    const parent = element.offsetParent;

    return element.offsetTop + (parent instanceof HTMLElement ? this.offsetWithinBody(parent) : 0);
  }

  private measureReelRows(): void {
    const items = this._body.querySelectorAll<HTMLElement>('[data-emoji-native], [data-emoji-section-title]');

    for (const item of items) {
      const glyph = item.firstElementChild;

      if (!(glyph instanceof HTMLElement)) {
        continue;
      }

      // Measure the glyph, not its box: the band is one glyph deep, and a
      // section heading's box is mostly padding, so measuring that curls the
      // label a padding-height early — exactly where scrollToSection lands.
      const height = glyph.offsetHeight;

      if (height === 0) {
        continue;
      }

      const top = this.offsetWithinBody(glyph);
      const row = this._reelRows.at(-1);

      if (row?.top === top) {
        row.glyphs.push(glyph);
      } else {
        this._reelRows.push({ top, height, glyphs: [glyph] });
      }
    }
  }

  private updateReel(): void {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches
      || this._body.scrollHeight <= this._body.clientHeight) {
      this.resetReel();

      return;
    }

    // Measure after layout changes, not on every scroll frame.
    if (this._reelRows.length === 0) {
      this.measureReelRows();
    }

    const viewTop = this._body.scrollTop;
    const viewBottom = viewTop + this._body.clientHeight;

    this.resetReel();

    for (const row of this._reelRows) {
      if (row.top + row.height <= viewTop || row.top >= viewBottom) {
        continue;
      }

      // Start one row from the edge; waiting for clipping hides most of the curl.
      const center = row.top + row.height / 2;
      const topCurl = viewTop > 0 ? Math.max(0, 1 - (center - viewTop) / row.height) : 0;
      const bottomCurl = viewBottom < this._body.scrollHeight ? Math.max(0, 1 - (viewBottom - center) / row.height) : 0;
      const curl = Math.min(1, Math.max(topCurl, bottomCurl));

      if (curl === 0) {
        continue;
      }

      const atTop = topCurl >= bottomCurl;
      const tilt = (REEL_DISTORTION.maxTiltDeg * curl * (atTop ? 1 : -1)).toFixed(2);
      const scaleX = (1 - REEL_DISTORTION.maxSquashX * curl).toFixed(3);
      const scaleY = (1 - REEL_DISTORTION.maxSquashY * curl).toFixed(3);

      for (const glyph of row.glyphs) {
        glyph.style.transform = `perspective(${REEL_DISTORTION.perspective}px) rotateX(${tilt}deg) scaleX(${scaleX}) scaleY(${scaleY})`;
        glyph.style.transformOrigin = atTop ? 'center bottom' : 'center top';
        glyph.style.opacity = (1 - REEL_DISTORTION.maxDim * curl).toFixed(3);
        this._curledGlyphs.add(glyph);
      }
    }
  }

  // ─── Category Navigation ──────────────────────────────────

  private buildCategoryNav(visibleCategories: Set<string>): void {
    this._nav.innerHTML = '';

    const indicator = document.createElement('span');

    indicator.setAttribute('data-emoji-nav-indicator', '');
    indicator.setAttribute('aria-hidden', 'true');
    this._nav.appendChild(indicator);
    this._navButtons.clear();
    this._activeNavId = '';

    for (const [catId, catIcon] of CATEGORY_NAV) {
      if (!visibleCategories.has(catId)) {
        continue;
      }

      const catLabel = this.translateCategory(catId);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.innerHTML = catIcon;
      onHover(btn, catLabel, { placement: 'top', delay: 300 });
      btn.setAttribute('aria-label', catLabel);
      btn.setAttribute('data-emoji-nav', catId);
      btn.className = [
        'flex-1 h-[36px] flex items-center justify-center',
        'rounded-lg cursor-pointer opacity-50',
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
      this.renderEmojiGrid(this._allEmojis);

      return;
    }

    this.setNavHidden(true);
    // Uncapped: the grid renders every match, unlike the inline trigger's
    // flat, length-limited menu.
    const results = searchEmojisRanked(this._allEmojis, query, this._localeData, UNCAPPED_RESULTS);

    this.announceResults(results.length);

    if (results.length === 0) {
      if (!this._showingEmptyState) {
        this.renderEmptyState();
      }
    } else {
      this._body.innerHTML = '';
      this._emojiButtons = [];
      this._focusedEmoji = null;
      this._reelRows = [];
      this.resetReel();
      this._sectionEls.clear();
      this._showingEmptyState = false;
      this._hasFullGrid = false;

      const byCategory = groupEmojisByCategory(results);

      for (const [category, categoryEmojis] of byCategory) {
        const section = this.buildSection(this.translateCategory(category), categoryEmojis);

        section.setAttribute('data-emoji-section', category);
        this._sectionEls.set(category, section);
        this._body.appendChild(section);
      }
    }
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
    this._reelRows = [];
    this.resetReel();
    this._sectionEls.clear();
    this._showingEmptyState = false;

    const visibleCategories = new Set<string>();

    if (!this._inline) {
      // Curated callout section first — inline mode has no callout-specific
      // affordance to curate for, so it skips straight to standard categories.
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

    // Standard categories. In Callout mode, exclude curated emojis here —
    // they already have their own section above, so this avoids duplicates.
    // Inline mode built no curated section, so nothing to exclude: those
    // twenty emojis are ordinary emojis that stay in their own category.
    const curatedSet = this._inline ? new Set<string>() : new Set(CURATED_CALLOUT_EMOJIS);
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
    this._hasFullGrid = true;

    // Set initial active nav after layout
    this.scheduleScrollEffects();
  }

  private renderEmptyState(): void {
    this._body.innerHTML = '';
    this._emojiButtons = [];
    this._focusedEmoji = null;
    this._reelRows = [];
    this.resetReel();
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

    if (this._inline) {
      this._header.hidden = true;
      this._body.appendChild(this._header);
    }
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

    if (this._inline && this._sectionEls.size === 0) {
      this._header.hidden = false;
      heading.appendChild(this._header);
    }

    section.appendChild(heading);
    section.appendChild(this.buildGrid(emojis));

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
        'text-[1.25rem] leading-none rounded-lg cursor-pointer',
        'hover:bg-neutral-100 theme-dark:hover:bg-neutral-800',
        'transition-transform duration-75',
      ].join(' ');
      btn.addEventListener('click', () => {
        this.onSelect(this.getSkinnedNative(emoji));
        this.close();
      });
      onHover(btn, this.getDisplayName(emoji), { placement: 'bottom' });
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
    const left = Math.max(8, Math.min(rect.left - 8, viewportWidth - width - 8));

    this._element.style.top = `${top}px`;
    this._element.style.left = `${left}px`;
    this._element.style.transformOrigin = `${Math.max(0, Math.min(width, rect.left + rect.width / 2 - left))}px ${above ? 'bottom' : 'top'}`;
  }
}
