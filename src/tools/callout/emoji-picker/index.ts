// src/tools/callout/emoji-picker/index.ts

import { loadEmojiData, searchEmojis, groupEmojisByCategory, CURATED_CALLOUT_EMOJIS, type ProcessedEmoji } from './emoji-data';
import { onHover } from '../../../components/utils/tooltip';
import { REMOVE_EMOJI_KEY, FILTER_EMOJIS_KEY, CALLOUT_EMOJI_CATEGORY_KEY, NO_EMOJIS_FOUND_KEY, PICK_RANDOM_KEY, SKIN_TONE_KEY } from '../constants';
import {
  IconSearch,
  IconEmojiStar,
  IconEmojiSmile,
  IconEmojiSprout,
  IconEmojiUtensils,
  IconEmojiBall,
  IconEmojiGlobe,
  IconEmojiLightbulb,
  IconEmojiHash,
  IconEmojiFlag,
} from '../../../components/icons';

interface I18n {
  t: (key: string) => string;
}

interface EmojiPickerOptions {
  onSelect: (native: string) => void;
  onRemove: () => void;
  i18n: I18n;
}

/** SVG icon and label for each emoji category (display order). */
const CATEGORY_NAV: ReadonlyArray<readonly [id: string, icon: string, label: string]> = [
  ['callout', IconEmojiStar, 'Callout'],
  ['people', IconEmojiSmile, 'People'],
  ['nature', IconEmojiSprout, 'Nature'],
  ['foods', IconEmojiUtensils, 'Food'],
  ['activity', IconEmojiBall, 'Activity'],
  ['places', IconEmojiGlobe, 'Travel'],
  ['objects', IconEmojiLightbulb, 'Objects'],
  ['symbols', IconEmojiHash, 'Symbols'],
  ['flags', IconEmojiFlag, 'Flags'],
];

/** Raised-hand emoji for each skin tone (default + 5 Fitzpatrick modifiers). */
const SKIN_TONE_HANDS: readonly string[] = [
  '✋', '✋🏻', '✋🏼', '✋🏽', '✋🏾', '✋🏿',
];

/** Dice SVG for the random button. */
const ICON_DICE = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.2"/><circle cx="4.5" cy="4.5" r=".9" fill="currentColor"/><circle cx="7" cy="7" r=".9" fill="currentColor"/><circle cx="9.5" cy="9.5" r=".9" fill="currentColor"/></svg>';

export class EmojiPicker {
  private readonly onSelect: (native: string) => void;
  private readonly onRemove: () => void;
  private readonly i18n: I18n;

  private _element: HTMLElement;
  private _body: HTMLElement;
  private _nav: HTMLElement;
  private _filterInput: HTMLInputElement;
  private _open = false;
  private _allEmojis: ProcessedEmoji[] = [];
  private _skinTone = 0;

  private _anchorEl: HTMLElement | null = null;
  private _backdrop: HTMLElement | null = null;

  /** Maps category id -> nav button for active-state management. */
  private _navButtons = new Map<string, HTMLButtonElement>();
  /** Maps category id -> section element for scroll targeting. */
  private _sectionEls = new Map<string, HTMLElement>();
  /** Currently highlighted category in the nav bar. */
  private _activeNavId = '';
  /** rAF handle for scroll-based nav updates. */
  private _navRafId = 0;
  /** Skin tone selector buttons for visual updates. */
  private _skinToneButtons: HTMLButtonElement[] = [];
  private _skinToneToggle!: HTMLButtonElement;
  private _skinTonePopover!: HTMLElement;

  constructor(options: EmojiPickerOptions) {
    this.onSelect = options.onSelect;
    this.onRemove = options.onRemove;
    this.i18n = options.i18n;
    this._element = this.buildElement();

    const body = this._element.querySelector<HTMLElement>('[data-emoji-picker-body]');
    const nav = this._element.querySelector<HTMLElement>('[data-emoji-picker-nav]');
    const filterInput = this._element.querySelector<HTMLInputElement>('input[type="text"]');

    if (body === null || nav === null || filterInput === null) {
      throw new Error('EmojiPicker: failed to build required elements');
    }

    this._body = body;
    this._nav = nav;
    this._filterInput = filterInput;

    this._body.addEventListener('scroll', () => {
      cancelAnimationFrame(this._navRafId);
      this._navRafId = requestAnimationFrame(() => this.updateActiveNav());
    }, { passive: true });
  }

  public getElement(): HTMLElement {
    return this._element;
  }

  public isOpen(): boolean {
    return this._open;
  }

  public async open(anchor: HTMLElement): Promise<void> {
    this._anchorEl = anchor;
    this._open = true;
    this._filterInput.value = '';
    this._element.setAttribute('data-theme', this.resolveTheme());

    if (this._allEmojis.length === 0) {
      this._allEmojis = await loadEmojiData();
    }

    this.renderEmojiGrid(this._allEmojis);
    this.showBackdrop();
    this.position(anchor);
    this._element.hidden = false;

    // Replay the opening animation
    this._element.style.animation = 'none';
    void this._element.offsetHeight;
    this._element.style.animation = '';

    this._filterInput.focus();
  }

  public close(): void {
    this._open = false;
    this._element.hidden = true;
    this.closeSkinTonePopover();
    this.removeBackdrop();
    this._anchorEl?.focus();
  }

  // ─── DOM Construction ─────────────────────────────────────

  private buildElement(): HTMLElement {
    const el = document.createElement('div');

    el.setAttribute('data-blok-emoji-picker', '');
    el.className = [
      'absolute z-50 w-[340px] overflow-hidden rounded-2xl',
      'border border-neutral-200/70 bg-white shadow-2xl',
      'theme-dark:border-neutral-700/50 theme-dark:bg-neutral-900',
    ].join(' ');
    el.hidden = true;

    // Header: search input + random button + remove button
    const header = document.createElement('div');
    header.className = 'flex items-center gap-2.5 px-3 pt-3 pb-2';

    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'relative flex-1 min-w-0';

    const iconSpan = document.createElement('span');
    iconSpan.className = [
      'pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 flex items-center',
      'text-neutral-400 theme-dark:text-neutral-500 [&>svg]:w-[16px] [&>svg]:h-[16px]',
    ].join(' ');
    iconSpan.innerHTML = IconSearch;

    const input = document.createElement('input');
    input.type = 'text';
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

    // Skin tone hand toggle (separate button next to search input)
    const skinToneWrapper = document.createElement('div');

    skinToneWrapper.className = 'relative flex-shrink-0';

    const skinToggle = document.createElement('button');

    skinToggle.type = 'button';
    skinToggle.setAttribute('data-emoji-picker-skin-toggle', '');
    skinToggle.setAttribute('aria-label', this.i18n.t(SKIN_TONE_KEY));
    skinToggle.title = this.i18n.t(SKIN_TONE_KEY);
    skinToggle.className = [
      'w-[28px] h-[28px] flex items-center justify-center rounded-lg',
      'text-[14px] leading-none cursor-pointer select-none',
      'hover:bg-neutral-100 theme-dark:hover:bg-neutral-800',
      'active:scale-90 transition-all duration-100',
    ].join(' ');
    skinToggle.textContent = SKIN_TONE_HANDS[this._skinTone];
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
    randomBtn.title = this.i18n.t(PICK_RANDOM_KEY);
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
    removeBtn.title = this.i18n.t(REMOVE_EMOJI_KEY);
    removeBtn.className = [
      'flex-shrink-0 w-[34px] h-[34px] flex items-center justify-center rounded-lg',
      'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600',
      'theme-dark:hover:bg-neutral-800 theme-dark:hover:text-neutral-300',
      'transition-colors duration-100 cursor-pointer',
    ].join(' ');
    removeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
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

    // Scrollable body
    const body = document.createElement('div');
    body.setAttribute('data-emoji-picker-body', '');
    body.className = 'overflow-y-auto max-h-[320px] px-1.5 pb-2';
    el.appendChild(body);

    // Category navigation bar (below emoji grid)
    const nav = document.createElement('div');
    nav.setAttribute('data-emoji-picker-nav', '');
    nav.className = [
      'flex items-center px-3 pt-1 pb-1',
      'border-t border-neutral-100 theme-dark:border-neutral-800',
    ].join(' ');
    el.appendChild(nav);

    // Close skin tone popover on click outside toggle/popover
    el.addEventListener('mousedown', (e: MouseEvent) => {
      const target = e.target as Node;

      if (!this._skinTonePopover.hidden
        && !this._skinTonePopover.contains(target)
        && !this._skinToneToggle.contains(target)) {
        this.closeSkinTonePopover();
      }
    });

    // Keyboard handler
    el.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!this._skinTonePopover.hidden) {
          this.closeSkinTonePopover();

          return;
        }

        this.close();
      }
    });

    return el;
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

    this._skinToneButtons = [];

    for (const [index, hand] of SKIN_TONE_HANDS.entries()) {
      const btn = document.createElement('button');

      btn.type = 'button';
      btn.textContent = hand;
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
        this.closeSkinTonePopover();
      });
      popover.appendChild(btn);
      this._skinToneButtons.push(btn);
    }

    return popover;
  }

  private applySkinToneActiveStyle(btn: HTMLButtonElement, active: boolean): void {
    const classes = ['bg-neutral-100', 'theme-dark:bg-neutral-700', 'ring-2', 'ring-neutral-300/60', 'theme-dark:ring-neutral-600/60'];

    if (active) {
      btn.classList.add(...classes);
    } else {
      btn.classList.remove(...classes);
    }
  }

  private toggleSkinTonePopover(): void {
    this._skinTonePopover.hidden = !this._skinTonePopover.hidden;
    this.updateSkinToneToggleActive();
  }

  private closeSkinTonePopover(): void {
    this._skinTonePopover.hidden = true;
    this.updateSkinToneToggleActive();
  }

  private updateSkinToneToggleActive(): void {
    const active = !this._skinTonePopover.hidden;
    const classes = ['bg-neutral-100', 'theme-dark:bg-neutral-700'];

    if (active) {
      this._skinToneToggle.classList.add(...classes);
    } else {
      this._skinToneToggle.classList.remove(...classes);
    }
  }

  private setSkinTone(index: number): void {
    this._skinTone = index;

    // Update the hand toggle to reflect current skin tone
    this._skinToneToggle.textContent = SKIN_TONE_HANDS[index];

    // Update skin tone popover button visuals
    for (const [i, btn] of this._skinToneButtons.entries()) {
      this.applySkinToneActiveStyle(btn, i === index);
    }

    // Update all emoji buttons in-place (no re-render, preserves scroll)
    const buttons = Array.from(this._body.querySelectorAll<HTMLButtonElement>('[data-emoji-native]'));

    for (const btn of buttons) {
      const native = btn.getAttribute('data-emoji-native');

      if (native === null) {
        continue;
      }

      const emoji = this._allEmojis.find(e => e.native === native);

      if (emoji !== undefined) {
        btn.textContent = this.getSkinnedNative(emoji);
      }
    }
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
    this.close();
  }

  // ─── Category Navigation ──────────────────────────────────

  private buildCategoryNav(visibleCategories: Set<string>): void {
    this._nav.innerHTML = '';
    this._navButtons.clear();
    this._activeNavId = '';

    for (const [catId, catIcon, catLabel] of CATEGORY_NAV) {
      if (!visibleCategories.has(catId)) {
        continue;
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.innerHTML = catIcon;
      btn.title = catLabel;
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
      btn.addEventListener('click', () => this.scrollToSection(catId));

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

    this._body.scrollTo({
      top: this._body.scrollTop + (sectionRect.top - bodyRect.top),
      behavior: 'smooth',
    });
  }

  private updateActiveNav(): void {
    const bodyTop = this._body.getBoundingClientRect().top;
    const activeId = [...this._sectionEls.entries()]
      .filter(([, el]) => el.getBoundingClientRect().top - bodyTop <= 20)
      .reduce<string>((_, [id]) => id, '');

    if (activeId === this._activeNavId) {
      return;
    }

    this._activeNavId = activeId;

    for (const [id, btn] of this._navButtons) {
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

  private handleFilterChange(query: string): void {
    if (query.trim() === '') {
      this._nav.hidden = false;
      this.renderEmojiGrid(this._allEmojis);

      return;
    }

    this._nav.hidden = true;
    const results = searchEmojis(this._allEmojis, query);

    if (results.length === 0) {
      this.renderEmptyState();
    } else {
      this.renderFlatGrid(results);
    }
  }

  private renderEmojiGrid(emojis: ProcessedEmoji[]): void {
    this._body.innerHTML = '';
    this._sectionEls.clear();

    const visibleCategories = new Set<string>();

    // Curated callout section first
    const calloutEmojis = CURATED_CALLOUT_EMOJIS
      .map(native => emojis.find(e => e.native === native))
      .filter((e): e is ProcessedEmoji => e !== undefined);

    if (calloutEmojis.length > 0) {
      visibleCategories.add('callout');
      const section = this.buildSection(this.i18n.t(CALLOUT_EMOJI_CATEGORY_KEY), calloutEmojis);
      section.setAttribute('data-emoji-section', 'callout');
      this._sectionEls.set('callout', section);
      this._body.appendChild(section);
    }

    // Standard categories
    const byCategory = groupEmojisByCategory(emojis);

    for (const [category, categoryEmojis] of byCategory) {
      visibleCategories.add(category);
      const section = this.buildSection(category, categoryEmojis);
      section.setAttribute('data-emoji-section', category);
      this._sectionEls.set(category, section);
      this._body.appendChild(section);
    }

    this.buildCategoryNav(visibleCategories);
    this._nav.hidden = false;

    // Set initial active nav after layout
    requestAnimationFrame(() => this.updateActiveNav());
  }

  private renderFlatGrid(emojis: ProcessedEmoji[]): void {
    this._body.innerHTML = '';
    this._sectionEls.clear();
    this._body.appendChild(this.buildGrid(emojis));
  }

  private renderEmptyState(): void {
    this._body.innerHTML = '';
    this._sectionEls.clear();

    const empty = document.createElement('div');
    empty.className = [
      'flex flex-col items-center justify-center py-10',
      'text-neutral-400 theme-dark:text-neutral-500 select-none',
    ].join(' ');

    const icon = document.createElement('span');
    icon.className = 'text-2xl mb-2 opacity-40';
    icon.textContent = '🔎';

    const text = document.createElement('span');
    text.className = 'text-[13px]';
    text.textContent = this.i18n.t(NO_EMOJIS_FOUND_KEY);

    empty.appendChild(icon);
    empty.appendChild(text);
    this._body.appendChild(empty);
  }

  private buildSection(title: string, emojis: ProcessedEmoji[]): HTMLElement {
    const section = document.createElement('div');
    const heading = document.createElement('div');
    heading.className = [
      'text-[11px] font-semibold uppercase tracking-wider px-2 pt-3 pb-1.5',
      'text-neutral-400/80 theme-dark:text-neutral-500/80',
      'sticky top-0 bg-white theme-dark:bg-neutral-900 z-10',
    ].join(' ');
    heading.textContent = title;
    section.appendChild(heading);
    section.appendChild(this.buildGrid(emojis));

    return section;
  }

  private buildGrid(emojis: ProcessedEmoji[]): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-8 gap-0.5 px-0.5 pt-1';

    for (const emoji of emojis) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = this.getSkinnedNative(emoji);
      btn.title = emoji.name;
      btn.setAttribute('data-emoji-native', emoji.native);
      btn.className = [
        'aspect-square flex items-center justify-center',
        'text-[1.25rem] leading-none rounded-lg cursor-pointer',
        'hover:bg-neutral-100 theme-dark:hover:bg-neutral-800',
        'hover:scale-110 active:scale-95',
        'transition-transform duration-75',
      ].join(' ');
      btn.addEventListener('click', () => {
        this.onSelect(this.getSkinnedNative(emoji));
        this.close();
      });
      onHover(btn, emoji.name, { placement: 'bottom' });
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
  }

  private removeBackdrop(): void {
    if (this._backdrop === null) {
      return;
    }

    // Move picker back to where the backdrop is before removing it
    this._backdrop.parentElement?.insertBefore(this._element, this._backdrop);
    this._backdrop.remove();
    this._backdrop = null;
  }

  // ─── Positioning ──────────────────────────────────────────

  private position(anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    const pickerHeight = 480;
    const pickerWidth = 340;
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Coordinates are viewport-relative (picker is inside a fixed backdrop)
    const top = rect.bottom + pickerHeight > viewportHeight
      ? rect.top - pickerHeight - 4
      : rect.bottom + 4;

    const left = rect.left + pickerWidth > viewportWidth
      ? rect.right - pickerWidth
      : rect.left;

    this._element.style.top = `${top}px`;
    this._element.style.left = `${left}px`;
  }
}
